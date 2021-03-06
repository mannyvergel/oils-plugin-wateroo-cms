module.exports = async function(pluginConf, web) {
  let pjson = require(web.conf.baseDir + '/package.json');
  let self = this;

  web.cms = self;
  //backwards
  web.dms = web.cms;

  web.cms.adminMenu = [];

  pluginConf = web.utils.extend(require('./conf/conf.js')(pluginConf), pluginConf);
  web.cms.conf = pluginConf;
  let context = pluginConf.context;
  
  var routes = {};


  let DmsUtils = require('./utils/DmsUtils');
  web.cms.utils = new DmsUtils(pluginConf, web);
  web.dmsUtils = web.cms.utils;
  web.cms.constants = {};
  web.cms.constants.file = 'file';
  web.cms.constants.folder = 'folder';

  web.cms.getCmsModel = function(docType) {
    if (web.modelCache[docType]) {
      return web.modelCache[docType];
    }

    return web.includeModel(web.cms.conf.models[docType]);
  };

  web.cms.registerCmsModel = function(modelName, path) {
    if (!web.cms.conf.models[modelName]) {
      web.cms.conf.models[modelName] = path;
    }
  };

  web.cms.getCmsModels = function() {
    let myModels = [];
    for (let i in web.cms.conf.models) {
      myModels.push(web.cms.getCmsModel(i));
    }

    return myModels;
  };

  web.cms.getDocTypeMap = function() {
    let myModels = web.cms.getCmsModels();
    let docTypeMap = {};
    for (let i in myModels) {
      let modelDict = myModels[i].getModelDictionary();
      if (modelDict.name != 'Document') {
        let label = modelDict.label || modelDict.name;
        docTypeMap[modelDict.name] = label;
      }
    }

    return docTypeMap;
  };

  if (pluginConf.defaultMenu) {
    web.cms.adminMenu = pluginConf.defaultMenu;
  } else {
    web.cms.adminMenu = [
      {items:[{text:'Dashboard', link:context}]},
      {items:[{text:'DMS', link:context + '/document/list'}]}
    ];
  }

  if (web.auth && pluginConf.accessRole) {
    
    routes['/^' + context + '*/'] = {
      isRegexp: true,
      all: function(req, res, next) {
        web.auth.loginUtils.handleRole(pluginConf.accessRole, req, res, next);
      }
    };
  } 

  web.on('beforeRender', function(view, options) {
    let cmsObj = {
      adminMenu: web.cms.adminMenu,
      conf: web.cms.conf,
    }
    options._cms = cmsObj;
  });

  routes[context] = web.include(pluginConf.contextController);

  routes[context + '/dashboard'] = require('./controllers/admin/dashboard.js')(pluginConf, web);

  routes[context + '/document/list'] = require('./controllers/document/list.js')(pluginConf, web);
  //routes[context + '/document/add/:DOC_TYPE'] = require('./controllers/document/add.js')(pkg, web);
  routes[context + '/document/add'] = require('./controllers/document/add.js')(pluginConf, web);
  routes[context + '/document/edit/:FILE_ID'] = require('./controllers/document/add.js')(pluginConf, web);
  routes[context + '/document/delete/:DOC_ID'] = require('./controllers/document/delete.js')(pluginConf, web);

  routes[context + '/site-settings'] = require('./controllers/admin/site-settings.js')(pluginConf, web);

  routes[context + '/document/upload'] = require('./controllers/document/upload.js');
  routes[context + '/document/download'] = require('./controllers/document/download.js');

  routes['/plugin/cms/codemirror/codemirror.min.css'] = {
    get: function(req, res) {
      web.utils.serveStaticFile(pluginConf.pluginPath + '/static/codemirror/codemirror.min.css', res);
    }
  };

  routes['/plugin/cms/codemirror/codemirror.min.js'] = {
    get: function(req, res) {
      web.utils.serveStaticFile(pluginConf.pluginPath + '/static/codemirror/codemirror.min.js', res);
    }
  };

  routes['/css/plugin/cms/admin.css'] = {
    get: function(req, res) {
      web.utils.serveStaticFile(pluginConf.pluginPath + '/static/admin.css', res);
    }
  };

  routes['/css/plugin/cms/dms.css'] = {
    get: function(req, res) {
      web.utils.serveStaticFile(pluginConf.pluginPath + '/static/dms.css', res);
    }
  };

  routes['/js/plugin/cms/list-dropzone.js'] = {
    get: function(req, res) {
      web.utils.serveStaticFile(pluginConf.pluginPath + '/static/list-dropzone.js', res);
    }
  };
  web.addRoutes(routes);
  await web.cms.utils.initDocRoutes();

  const SiteSetting = web.cms.getCmsModel('SiteSetting');

  let updateSiteSettingCache = function(options) {
    SiteSetting.findOne({docType:'SiteSetting'}).lean().exec(function(err,siteSetting) {
      web.cms.siteSettingCache = web.cms.siteSettingCache || {
        title: pluginConf.defaultSiteTitle
      };

      if (siteSetting) {
        siteSetting.version = siteSetting.version || web.conf.siteVersion || pjson.version;
        web.cms.siteSettingCache = siteSetting;
        if (options) {
          options._site  = web.cms.siteSetting;
        }

        console.log('Site setting cache updated: ' + JSON.stringify(siteSetting));
        
      }
      
    });
  };
  web.cms.updateSiteSettingCache = updateSiteSettingCache;
  updateSiteSettingCache();

  web.on('beforeRender', function(view, options) {
    
    let site = web.cms.siteSettingCache || {};
    options._site = site;

  });

  web.on('initServer', async function() {

    if (!web.syspars) {
      throw new Error('CMS needs oils-plugin-syspars plugin');
    }

    let Document = web.includeModel(pluginConf.models.Document);

    await web.runOnce('CMS_RUN_ONCE', async function() {
      await cmsRunOnce();
    })
      
  });
  



  async function cmsRunOnce() {
    if (web.auth && pluginConf.autoCreateAdminUser) {
      let User = web.auth.UserModel;


      let saveAdminUser = function() {

        //deprecated, auth plugin now handles admin registration for new websites

        if (!pluginConf.defaultAdminPassword) {
          throw new Error("cms-pluginConf.defaultAdminPassword is required");
        }
        let user = new User();
          user.username = 'admin';
          user.password = pluginConf.defaultAdminPassword;
          user.birthday = new Date();
       
          user.role = 'ADMIN';
          user.fullname = 'Admin';
          user.nickname = 'Admin';
          user.email = 'admin@example.com';
          user.save(function(err) {
            if (err) throw err;
          });
          console.log('Admin user saved.');
      };

      console.log('First time to run. Running DMS init data.');
       //init-data
      User.findOne({username:'admin'}, function(err, user) {
        if (!user) {
          saveAdminUser();
        } else if (user.role != 'ADMIN') {
          user.remove(function() {
            saveAdminUser();
          });
        }
        
      });
    }

    SiteSetting.findOne({docType:'SiteSetting'}, function(err, siteSetting) {
      if (!siteSetting) {
        siteSetting = new SiteSetting();
        siteSetting.title = pluginConf.defaultSiteTitle;
        siteSetting.save(function(err) {
          if (err) throw err;
            web.cms.updateSiteSettingCache();
        });
      }
    });
  }

};





