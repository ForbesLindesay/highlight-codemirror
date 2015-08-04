// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: http://codemirror.net/LICENSE
// This is CodeMirror (http://codemirror.net), a code editor
// implemented in JavaScript on top of the browser's DOM.
//
// You can find some technical background for some of the code below
// at http://marijnhaverbeke.nl/blog/#cm-internals .
!function(mod) {
  if ("object" == typeof exports && "object" == typeof module) // CommonJS
  module.exports = mod(); else {
    if ("function" == typeof define && define.amd) // AMD
    return define([], mod);
    // Plain browser env
    this.CodeMirror = mod();
  }
}(function() {
  "use strict";
  var CodeMirror = {};
  // OPTION DEFAULTS
  // The default configuration options.
  CodeMirror.defaults = {};
  // Functions to run when options are changed.
  CodeMirror.optionHandlers = {};
  // Passed to option handlers when there is no old value.
  CodeMirror.Init = {
    toString: function() {
      return "CodeMirror.Init";
    }
  };
  // MODE DEFINITION AND QUERYING
  // Known modes, by name and by MIME
  var modes = CodeMirror.modes = {}, mimeModes = CodeMirror.mimeModes = {};
  // Extra arguments are stored as the mode's dependencies, which is
  // used by (legacy) mechanisms like loadmode.js to automatically
  // load a mode. (Preferred mechanism is the require/define calls.)
  CodeMirror.defineMode = function(name, mode) {
    CodeMirror.defaults.mode || "null" == name || (CodeMirror.defaults.mode = name);
    arguments.length > 2 && (mode.dependencies = Array.prototype.slice.call(arguments, 2));
    modes[name] = mode;
  };
  CodeMirror.defineMIME = function(mime, spec) {
    mimeModes[mime] = spec;
  };
  // Given a MIME type, a {name, ...options} config object, or a name
  // string, return a mode config object.
  CodeMirror.resolveMode = function(spec) {
    if ("string" == typeof spec && mimeModes.hasOwnProperty(spec)) spec = mimeModes[spec]; else if (spec && "string" == typeof spec.name && mimeModes.hasOwnProperty(spec.name)) {
      var found = mimeModes[spec.name];
      "string" == typeof found && (found = {
        name: found
      });
      spec = createObj(found, spec);
      spec.name = found.name;
    } else if ("string" == typeof spec && /^[\w\-]+\/[\w\-]+\+xml$/.test(spec)) return CodeMirror.resolveMode("application/xml");
    return "string" == typeof spec ? {
      name: spec
    } : spec || {
      name: "null"
    };
  };
  // Given a mode spec (anything that resolveMode accepts), find and
  // initialize an actual mode object.
  CodeMirror.getMode = function(options, spec) {
    var spec = CodeMirror.resolveMode(spec);
    var mfactory = modes[spec.name];
    if (!mfactory) return CodeMirror.getMode(options, "text/plain");
    var modeObj = mfactory(options, spec);
    if (modeExtensions.hasOwnProperty(spec.name)) {
      var exts = modeExtensions[spec.name];
      for (var prop in exts) {
        if (!exts.hasOwnProperty(prop)) continue;
        modeObj.hasOwnProperty(prop) && (modeObj["_" + prop] = modeObj[prop]);
        modeObj[prop] = exts[prop];
      }
    }
    modeObj.name = spec.name;
    spec.helperType && (modeObj.helperType = spec.helperType);
    if (spec.modeProps) for (var prop in spec.modeProps) modeObj[prop] = spec.modeProps[prop];
    return modeObj;
  };
  // Minimal default mode.
  CodeMirror.defineMode("null", function() {
    return {
      token: function(stream) {
        stream.skipToEnd();
      }
    };
  });
  CodeMirror.defineMIME("text/plain", "null");
  // This can be used to attach properties to mode objects from
  // outside the actual mode definition.
  var modeExtensions = CodeMirror.modeExtensions = {};
  CodeMirror.extendMode = function(mode, properties) {
    var exts = modeExtensions.hasOwnProperty(mode) ? modeExtensions[mode] : modeExtensions[mode] = {};
    copyObj(properties, exts);
  };
  // EXTENSIONS
  CodeMirror.defineExtension = function(name, func) {};
  CodeMirror.defineDocExtension = function(name, func) {};
  var initHooks = [];
  CodeMirror.defineInitHook = function(f) {
    initHooks.push(f);
  };
  var helpers = CodeMirror.helpers = {};
  CodeMirror.registerHelper = function(type, name, value) {
    helpers.hasOwnProperty(type) || (helpers[type] = CodeMirror[type] = {
      _global: []
    });
    helpers[type][name] = value;
  };
  CodeMirror.registerGlobalHelper = function(type, name, predicate, value) {
    CodeMirror.registerHelper(type, name, value);
    helpers[type]._global.push({
      pred: predicate,
      val: value
    });
  };
  // MODE STATE HANDLING
  // Utility functions for working with state. Exported because nested
  // modes need to do this for their inner modes.
  CodeMirror.copyState = function(mode, state) {
    if (state === !0) return state;
    if (mode.copyState) return mode.copyState(state);
    var nstate = {};
    for (var n in state) {
      var val = state[n];
      val instanceof Array && (val = val.concat([]));
      nstate[n] = val;
    }
    return nstate;
  };
  CodeMirror.startState = function(mode, a1, a2) {
    return mode.startState ? mode.startState(a1, a2) : !0;
  };
  // Given a mode and a state (for that mode), find the inner mode and
  // state at the position that the state refers to.
  CodeMirror.innerMode = function(mode, state) {
    for (;mode.innerMode; ) {
      var info = mode.innerMode(state);
      if (!info || info.mode == mode) break;
      state = info.state;
      mode = info.mode;
    }
    return info || {
      mode: mode,
      state: state
    };
  };
  // STRING STREAM
  // Fed to the mode parsers, provides helper functions to make
  // parsers more succinct.
  var StringStream = CodeMirror.StringStream = function(string, tabSize) {
    this.pos = this.start = 0;
    this.string = string;
    this.tabSize = tabSize || 8;
    this.lastColumnPos = this.lastColumnValue = 0;
    this.lineStart = 0;
  };
  StringStream.prototype = {
    eol: function() {
      return this.pos >= this.string.length;
    },
    sol: function() {
      return this.pos == this.lineStart;
    },
    peek: function() {
      return this.string.charAt(this.pos) || void 0;
    },
    next: function() {
      if (this.pos < this.string.length) return this.string.charAt(this.pos++);
    },
    eat: function(match) {
      var ch = this.string.charAt(this.pos);
      if ("string" == typeof match) var ok = ch == match; else var ok = ch && (match.test ? match.test(ch) : match(ch));
      if (ok) {
        ++this.pos;
        return ch;
      }
    },
    eatWhile: function(match) {
      var start = this.pos;
      for (;this.eat(match); ) ;
      return this.pos > start;
    },
    eatSpace: function() {
      var start = this.pos;
      for (;/[\s\u00a0]/.test(this.string.charAt(this.pos)); ) ++this.pos;
      return this.pos > start;
    },
    skipToEnd: function() {
      this.pos = this.string.length;
    },
    skipTo: function(ch) {
      var found = this.string.indexOf(ch, this.pos);
      if (found > -1) {
        this.pos = found;
        return !0;
      }
    },
    backUp: function(n) {
      this.pos -= n;
    },
    column: function() {
      if (this.lastColumnPos < this.start) {
        this.lastColumnValue = countColumn(this.string, this.start, this.tabSize, this.lastColumnPos, this.lastColumnValue);
        this.lastColumnPos = this.start;
      }
      return this.lastColumnValue - (this.lineStart ? countColumn(this.string, this.lineStart, this.tabSize) : 0);
    },
    indentation: function() {
      return countColumn(this.string, null, this.tabSize) - (this.lineStart ? countColumn(this.string, this.lineStart, this.tabSize) : 0);
    },
    match: function(pattern, consume, caseInsensitive) {
      if ("string" != typeof pattern) {
        var match = this.string.slice(this.pos).match(pattern);
        if (match && match.index > 0) return null;
        match && consume !== !1 && (this.pos += match[0].length);
        return match;
      }
      var cased = function(str) {
        return caseInsensitive ? str.toLowerCase() : str;
      };
      var substr = this.string.substr(this.pos, pattern.length);
      if (cased(substr) == cased(pattern)) {
        consume !== !1 && (this.pos += pattern.length);
        return !0;
      }
    },
    current: function() {
      return this.string.slice(this.start, this.pos);
    },
    hideFirstChars: function(n, inner) {
      this.lineStart += n;
      try {
        return inner();
      } finally {
        this.lineStart -= n;
      }
    }
  };
  // Set up methods on CodeMirror's prototype to redirect to the editor's document.
  "iter insert remove copy getEditor constructor".split(" ");
  // Returned or thrown by various protocols to signal 'I'm not
  // handling this'.
  CodeMirror.Pass = {
    toString: function() {
      return "CodeMirror.Pass";
    }
  };
  // Counts the column offset in a string, taking tabs into account.
  // Used mostly to find indentation.
  var countColumn = CodeMirror.countColumn = function(string, end, tabSize, startIndex, startValue) {
    if (null == end) {
      end = string.search(/[^\s\u00a0]/);
      -1 == end && (end = string.length);
    }
    for (var i = startIndex || 0, n = startValue || 0; ;) {
      var nextTab = string.indexOf("	", i);
      if (0 > nextTab || nextTab >= end) return n + (end - i);
      n += nextTab - i;
      n += tabSize - n % tabSize;
      i = nextTab + 1;
    }
  };
  function nothing() {}
  function createObj(base, props) {
    var inst;
    if (Object.create) inst = Object.create(base); else {
      nothing.prototype = base;
      inst = new nothing();
    }
    props && copyObj(props, inst);
    return inst;
  }
  function copyObj(obj, target, overwrite) {
    target || (target = {});
    for (var prop in obj) !obj.hasOwnProperty(prop) || overwrite === !1 && target.hasOwnProperty(prop) || (target[prop] = obj[prop]);
    return target;
  }
  var nonASCIISingleCaseWordChar = /[\u00df\u0587\u0590-\u05f4\u0600-\u06ff\u3040-\u309f\u30a0-\u30ff\u3400-\u4db5\u4e00-\u9fcc\uac00-\ud7af]/;
  CodeMirror.isWordChar = function(ch) {
    return /\w/.test(ch) || ch > "" && (ch.toUpperCase() != ch.toLowerCase() || nonASCIISingleCaseWordChar.test(ch));
  };
  // See if "".split is the broken IE version, if so, provide an
  // alternative way to split lines.
  CodeMirror.splitLines = 3 != "\n\nb".split(/\n/).length ? function(string) {
    var pos = 0, result = [], l = string.length;
    for (;l >= pos; ) {
      var nl = string.indexOf("\n", pos);
      -1 == nl && (nl = string.length);
      var line = string.slice(pos, "\r" == string.charAt(nl - 1) ? nl - 1 : nl);
      var rt = line.indexOf("\r");
      if (-1 != rt) {
        result.push(line.slice(0, rt));
        pos += rt + 1;
      } else {
        result.push(line);
        pos = nl + 1;
      }
    }
    return result;
  } : function(string) {
    return string.split(/\r\n?|\n/);
  };
  // THE END
  CodeMirror.version = "5.5.0";
  return CodeMirror;
});