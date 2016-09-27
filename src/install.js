var fs = require('fs');
var path = require('path');
var configTemp = path.resolve(__dirname,'./config.temp.json');
var LOCALPATH = process.env.HOME || process.env.USERPROFILE;
var ezpackConfig = path.join(LOCALPATH, '.ezpack/config.json');
if(!fs.existsSync(ezpackConfig)){
  var dirname = path.dirname(ezpackConfig);
  console.log('dirname: '+dirname);
  if(!fs.existsSync(dirname)){
    fs.mkdirSync(dirname); 
    console.log('mkdirSync: ');
  }
  fs.writeFileSync(ezpackConfig,fs.readFileSync(configTemp));
}
