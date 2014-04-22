'use strict';

var fs = require('fs');
var highlight = require('../');

process.once('message', function (mode) {
  var name = mode.name;
  var source = mode.source;
  var html = name === 'gas' ? highlight(source, {name: 'gas', architecture: 'ARMv6'}) : highlight(source, name);
  fs.writeFileSync(__dirname + '/output/' + name + '.html', html, 'utf8');
  process.exit(0);
});