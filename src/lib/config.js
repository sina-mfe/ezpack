/**
 * @author xiaojue[designsor@gmail.com]
 * @fileoverview config management
 */
var path = require('path');
var jsonfile = require('jsonfile');
var LOCALPATH = process.env.HOME || process.env.USERPROFILE;
var ezpackConfig = path.join(LOCALPATH, '.ezpack/config.json');

module.exports = {
  setSvn: function(username,pwd,command) {
    var config =jsonfile.readFileSync(ezpackConfig);
    config.svninfo = config.svninfo || {};
    config.svninfo.username = username;
    config.svninfo.password = pwd;
    config.svninfo.command = command || 'svn';
    jsonfile.writeFileSync(ezpackConfig,config);
    this.info();
  },
  info: function() {
    console.dir(jsonfile.readFileSync(ezpackConfig));
  }
};
