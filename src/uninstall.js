var fs = require('fs');
var path = require('path');
var configTemp = path.resolve(__dirname,'./config.temp.json');
var LOCALPATH = process.env.HOME || process.env.USERPROFILE;
var ezpackConfig = path.join(LOCALPATH, '.ezpack/config.json');
if(fs.existsSync(ezpackConfig)){
  var dirname = path.dirname(ezpackConfig);
  if(fs.existsSync(dirname)){
    fs.unlink(ezpackConfig,function(err){
    	if (err) {
	       return console.error(err);
	    }
	    fs.rmdir(dirname,function(err){
	    	if (err) {
		       return console.error(err);
		    }
	    })
    }); 
    
  }
}