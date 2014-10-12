'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');
var format = require('util').format;
var resolve = require('resolve').sync;
var escape = require('escape-html');
var CodeMirror = require('./lib/codemirror.js');

CodeMirror.runMode = function(string, modespec, callback) {
  var mode = CodeMirror.getMode({indentUnit: 2}, modespec);
  var lines = CodeMirror.splitLines(string), state = CodeMirror.startState(mode);
  for (var i = 0, e = lines.length; i < e; ++i) {
    if (i) callback("\n");
    var stream = new CodeMirror.StringStream(lines[i]);
    while (!stream.eol()) {
      var style = mode.token(stream, state);
      callback(stream.current(), style, i, stream.start, state);
      stream.start = stream.pos;
    }
  }
};

var cache = {};
cache[require.resolve('codemirror')] = CodeMirror;
CodeMirror.loadMode = function (name) {
  function loadFile(filename) {
    if (filename in cache) return cache[filename];
    var exports = (cache[filename] = {});
    var moduleObject = {exports: exports};
    function childRequire(name) {
      if (/^codemirror/.test(name)) return loadFile(require.resolve(name));
      else return loadFile(resolve(name, {basedir: path.dirname(filename)}));
    }
    var source = fs.readFileSync(filename, 'utf8');
    vm.runInNewContext(source, { CodeMirror: CodeMirror, module: moduleObject, exports: exports, require: childRequire }, filename);
    return (cache[filename] = moduleObject.exports);
  }
  return loadFile(/^[A-Za-z0-9]+$/.test(name) ? require.resolve('codemirror/mode/' + name + '/' + name + '.js') : path.resolve(name));
};

CodeMirror.highlight = function (string, options) {
  var html = '';
  var col = 0;
  var tabSize = options.tabSize;

  CodeMirror.runMode(string, options, function (text, style) {
    if (text === '\n') {
      html += '\n';
      col = 0;
      return;
    }

    var content = '';

    // replace tabs
    var pos = 0;
    while (true) {
      var idx = text.indexOf('\t', pos);
      if (idx === -1) {
        content += text.slice(pos);
        col += text.length - pos;
        break;
      } else {
        col += idx - pos;
        content += text.slice(pos, idx);
        var size = tabSize - col % tabSize;
        col += size;
        for (var i = 0; i < size; ++i) content += ' ';
        pos = idx + 1;
      }
    }

    content = escape(content);
    if (style) {
      var className = 'cm-' + style.replace(/ +/g, ' cm-');
      content = format('<span class="%s">%s</span>', className, content);
    }
    html += content;
  });

  return html;
};

function highlightCode(code, mode) {
  if (typeof mode === 'string') mode = {name: mode};
  var modeSpec = CodeMirror.resolveMode(mode);
  if (!modeSpec && (modeSpec.name === 'null' && mode.name !== 'null')) {
    CodeMirror.loadMode(mode.name);
  }
  return CodeMirror.highlight(code, mode);
}
for (var key in CodeMirror) {
  if (typeof CodeMirror[key] === 'function') {
    highlightCode[key] = CodeMirror[key].bind(CodeMirror);
  } else {
    highlightCode[key] = CodeMirror[key];
  }
}

module.exports = highlightCode;
