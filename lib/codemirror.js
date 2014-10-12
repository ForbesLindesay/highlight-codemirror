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
  // POSITION OBJECT
  // A Pos instance represents a position within the text.
  var Pos = CodeMirror.Pos = function(line, ch) {
    if (!(this instanceof Pos)) return new Pos(line, ch);
    this.line = line;
    this.ch = ch;
  };
  // Compare two positions, return 0 if they are the same, a negative
  // number when a is less, and a positive number otherwise.
  var cmp = CodeMirror.cmpPos = function(a, b) {
    return a.line - b.line || a.ch - b.ch;
  };
  function copyPos(x) {
    return Pos(x.line, x.ch);
  }
  function maxPos(a, b) {
    return cmp(a, b) < 0 ? b : a;
  }
  function minPos(a, b) {
    return cmp(a, b) < 0 ? a : b;
  }
  // SELECTION / CURSOR
  // Selection objects are immutable. A new one is created every time
  // the selection changes. A selection is one or more non-overlapping
  // (and non-touching) ranges, sorted, and an integer that indicates
  // which one is the primary selection (the one that's scrolled into
  // view, that getCursor returns, etc).
  function Selection(ranges, primIndex) {
    this.ranges = ranges;
    this.primIndex = primIndex;
  }
  Selection.prototype = {
    primary: function() {
      return this.ranges[this.primIndex];
    },
    equals: function(other) {
      if (other == this) return !0;
      if (other.primIndex != this.primIndex || other.ranges.length != this.ranges.length) return !1;
      for (var i = 0; i < this.ranges.length; i++) {
        var here = this.ranges[i], there = other.ranges[i];
        if (0 != cmp(here.anchor, there.anchor) || 0 != cmp(here.head, there.head)) return !1;
      }
      return !0;
    },
    deepCopy: function() {
      for (var out = [], i = 0; i < this.ranges.length; i++) out[i] = new Range(copyPos(this.ranges[i].anchor), copyPos(this.ranges[i].head));
      return new Selection(out, this.primIndex);
    },
    somethingSelected: function() {
      for (var i = 0; i < this.ranges.length; i++) if (!this.ranges[i].empty()) return !0;
      return !1;
    },
    contains: function(pos, end) {
      end || (end = pos);
      for (var i = 0; i < this.ranges.length; i++) {
        var range = this.ranges[i];
        if (cmp(end, range.from()) >= 0 && cmp(pos, range.to()) <= 0) return i;
      }
      return -1;
    }
  };
  function Range(anchor, head) {
    this.anchor = anchor;
    this.head = head;
  }
  Range.prototype = {
    from: function() {
      return minPos(this.anchor, this.head);
    },
    to: function() {
      return maxPos(this.anchor, this.head);
    },
    empty: function() {
      return this.head.line == this.anchor.line && this.head.ch == this.anchor.ch;
    }
  };
  // OPERATIONS
  // Operations are used to wrap a series of changes to the editor
  // state in such a way that each change won't have to update the
  // cursor and display (which would be awkward, slow, and
  // error-prone). Instead, display updates are batched and then all
  // combined and executed at once.
  var operationGroup = null;
  // UPDATING
  // Compute the position of the end of a change (its 'to' property
  // refers to the pre-change end).
  CodeMirror.changeEnd = function(change) {
    if (!change.text) return change.to;
    return Pos(change.from.line + change.text.length - 1, lst(change.text).length + (1 == change.text.length ? change.from.ch : 0));
  };
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
    if (arguments.length > 2) {
      mode.dependencies = [];
      for (var i = 2; i < arguments.length; ++i) mode.dependencies.push(arguments[i]);
    }
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
  CodeMirror.defineExtension = function() {};
  CodeMirror.defineDocExtension = function() {};
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
  // Connect or disconnect spans from a line.
  function detachMarkedSpans(line) {
    var spans = line.markedSpans;
    if (!spans) return;
    for (var i = 0; i < spans.length; ++i) spans[i].marker.detachLine(line);
    line.markedSpans = null;
  }
  // Detach a line from the document tree and its markers.
  function cleanUpLine(line) {
    line.parent = null;
    detachMarkedSpans(line);
  }
  // The document is represented as a BTree consisting of leaves, with
  // chunk of lines in them, and branches, with up to ten leaves or
  // other branch nodes below them. The top node is always a branch
  // node, and is the document object itself (meaning it has
  // additional methods and properties).
  //
  // All nodes have parent links. The tree is used both to go from
  // line numbers to line objects, and to go from objects to numbers.
  // It also indexes by height, and is used to convert between height
  // and line object, and to find the total height of the document.
  //
  // See also http://marijnhaverbeke.nl/blog/codemirror-line-tree.html
  function LeafChunk(lines) {
    this.lines = lines;
    this.parent = null;
    for (var i = 0, height = 0; i < lines.length; ++i) {
      lines[i].parent = this;
      height += lines[i].height;
    }
    this.height = height;
  }
  LeafChunk.prototype = {
    chunkSize: function() {
      return this.lines.length;
    },
    // Remove the n lines at offset 'at'.
    removeInner: function(at, n) {
      for (var i = at, e = at + n; e > i; ++i) {
        var line = this.lines[i];
        this.height -= line.height;
        cleanUpLine(line);
        signalLater(line, "delete");
      }
      this.lines.splice(at, n);
    },
    // Helper used to collapse a small branch into a single leaf.
    collapse: function(lines) {
      lines.push.apply(lines, this.lines);
    },
    // Insert the given array of lines at offset 'at', count them as
    // having the given height.
    insertInner: function(at, lines, height) {
      this.height += height;
      this.lines = this.lines.slice(0, at).concat(lines).concat(this.lines.slice(at));
      for (var i = 0; i < lines.length; ++i) lines[i].parent = this;
    },
    // Used to iterate over a part of the tree.
    iterN: function(at, n, op) {
      for (var e = at + n; e > at; ++at) if (op(this.lines[at])) return !0;
    }
  };
  function BranchChunk(children) {
    this.children = children;
    var size = 0, height = 0;
    for (var i = 0; i < children.length; ++i) {
      var ch = children[i];
      size += ch.chunkSize();
      height += ch.height;
      ch.parent = this;
    }
    this.size = size;
    this.height = height;
    this.parent = null;
  }
  BranchChunk.prototype = {
    chunkSize: function() {
      return this.size;
    },
    removeInner: function(at, n) {
      this.size -= n;
      for (var i = 0; i < this.children.length; ++i) {
        var child = this.children[i], sz = child.chunkSize();
        if (sz > at) {
          var rm = Math.min(n, sz - at), oldHeight = child.height;
          child.removeInner(at, rm);
          this.height -= oldHeight - child.height;
          if (sz == rm) {
            this.children.splice(i--, 1);
            child.parent = null;
          }
          if (0 == (n -= rm)) break;
          at = 0;
        } else at -= sz;
      }
      // If the result is smaller than 25 lines, ensure that it is a
      // single leaf node.
      if (this.size - n < 25 && (this.children.length > 1 || !(this.children[0] instanceof LeafChunk))) {
        var lines = [];
        this.collapse(lines);
        this.children = [ new LeafChunk(lines) ];
        this.children[0].parent = this;
      }
    },
    collapse: function(lines) {
      for (var i = 0; i < this.children.length; ++i) this.children[i].collapse(lines);
    },
    insertInner: function(at, lines, height) {
      this.size += lines.length;
      this.height += height;
      for (var i = 0; i < this.children.length; ++i) {
        var child = this.children[i], sz = child.chunkSize();
        if (sz >= at) {
          child.insertInner(at, lines, height);
          if (child.lines && child.lines.length > 50) {
            for (;child.lines.length > 50; ) {
              var spilled = child.lines.splice(child.lines.length - 25, 25);
              var newleaf = new LeafChunk(spilled);
              child.height -= newleaf.height;
              this.children.splice(i + 1, 0, newleaf);
              newleaf.parent = this;
            }
            this.maybeSpill();
          }
          break;
        }
        at -= sz;
      }
    },
    // When a node has grown, check whether it should be split.
    maybeSpill: function() {
      if (this.children.length <= 10) return;
      var me = this;
      do {
        var spilled = me.children.splice(me.children.length - 5, 5);
        var sibling = new BranchChunk(spilled);
        if (me.parent) {
          me.size -= sibling.size;
          me.height -= sibling.height;
          var myIndex = indexOf(me.parent.children, me);
          me.parent.children.splice(myIndex + 1, 0, sibling);
        } else {
          // Become the parent node
          var copy = new BranchChunk(me.children);
          copy.parent = me;
          me.children = [ copy, sibling ];
          me = copy;
        }
        sibling.parent = me.parent;
      } while (me.children.length > 10);
      me.parent.maybeSpill();
    },
    iterN: function(at, n, op) {
      for (var i = 0; i < this.children.length; ++i) {
        var child = this.children[i], sz = child.chunkSize();
        if (sz > at) {
          var used = Math.min(n, sz - at);
          if (child.iterN(at, used, op)) return !0;
          if (0 == (n -= used)) break;
          at = 0;
        } else at -= sz;
      }
    }
  };
  // Set up methods on CodeMirror's prototype to redirect to the editor's document.
  "iter insert remove copy getEditor".split(" ");
  // EVENT UTILITIES
  // Due to the fact that we still support jurassic IE versions, some
  // compatibility wrappers are needed.
  var e_preventDefault = CodeMirror.e_preventDefault = function(e) {
    e.preventDefault ? e.preventDefault() : e.returnValue = !1;
  };
  var e_stopPropagation = CodeMirror.e_stopPropagation = function(e) {
    e.stopPropagation ? e.stopPropagation() : e.cancelBubble = !0;
  };
  CodeMirror.e_stop = function(e) {
    e_preventDefault(e);
    e_stopPropagation(e);
  };
  // EVENT HANDLING
  // Lightweight event framework. on/off also work on DOM nodes,
  // registering native DOM handlers.
  CodeMirror.on = function(emitter, type, f) {
    if (emitter.addEventListener) emitter.addEventListener(type, f, !1); else if (emitter.attachEvent) emitter.attachEvent("on" + type, f); else {
      var map = emitter._handlers || (emitter._handlers = {});
      var arr = map[type] || (map[type] = []);
      arr.push(f);
    }
  };
  CodeMirror.off = function(emitter, type, f) {
    if (emitter.removeEventListener) emitter.removeEventListener(type, f, !1); else if (emitter.detachEvent) emitter.detachEvent("on" + type, f); else {
      var arr = emitter._handlers && emitter._handlers[type];
      if (!arr) return;
      for (var i = 0; i < arr.length; ++i) if (arr[i] == f) {
        arr.splice(i, 1);
        break;
      }
    }
  };
  CodeMirror.signal = function(emitter, type) {
    var arr = emitter._handlers && emitter._handlers[type];
    if (!arr) return;
    var args = Array.prototype.slice.call(arguments, 2);
    for (var i = 0; i < arr.length; ++i) arr[i].apply(null, args);
  };
  var orphanDelayedCallbacks = null;
  // Often, we want to signal events at a point where we are in the
  // middle of some work, but don't want the handler to start calling
  // other methods on the editor, which might be in an inconsistent
  // state or simply not expect any other events to happen.
  // signalLater looks whether there are any handlers, and schedules
  // them to be executed when the last operation ends, or, if no
  // operation is active, when a timeout fires.
  function signalLater(emitter, type) {
    var arr = emitter._handlers && emitter._handlers[type];
    if (!arr) return;
    var list, args = Array.prototype.slice.call(arguments, 2);
    if (operationGroup) list = operationGroup.delayedCallbacks; else if (orphanDelayedCallbacks) list = orphanDelayedCallbacks; else {
      list = orphanDelayedCallbacks = [];
      setTimeout(fireOrphanDelayed, 0);
    }
    function bnd(f) {
      return function() {
        f.apply(null, args);
      };
    }
    for (var i = 0; i < arr.length; ++i) list.push(bnd(arr[i]));
  }
  function fireOrphanDelayed() {
    var delayed = orphanDelayedCallbacks;
    orphanDelayedCallbacks = null;
    for (var i = 0; i < delayed.length; ++i) delayed[i]();
  }
  // Returned or thrown by various protocols to signal 'I'm not
  // handling this'.
  CodeMirror.Pass = {
    toString: function() {
      return "CodeMirror.Pass";
    }
  };
  function Delayed() {
    this.id = null;
  }
  Delayed.prototype.set = function(ms, f) {
    clearTimeout(this.id);
    this.id = setTimeout(f, ms);
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
  function lst(arr) {
    return arr[arr.length - 1];
  }
  function indexOf() {
    return -1;
  }
  [].indexOf && (indexOf = function() {});
  function map(array, f) {
    var out = [];
    for (var i = 0; i < array.length; i++) out[i] = f(array[i], i);
    return out;
  }
  [].map && (map = function(array, f) {
    return array.map(f);
  });
  function createObj(base, props) {
    var inst;
    if (Object.create) inst = Object.create(base); else {
      var ctor = function() {};
      ctor.prototype = base;
      inst = new ctor();
    }
    props && copyObj(props, inst);
    return inst;
  }
  function copyObj(obj, target, overwrite) {
    target || (target = {});
    for (var prop in obj) !obj.hasOwnProperty(prop) || overwrite === !1 && target.hasOwnProperty(prop) || (target[prop] = obj[prop]);
    return target;
  }
  var nonASCIISingleCaseWordChar = /[\u00df\u0590-\u05f4\u0600-\u06ff\u3040-\u309f\u30a0-\u30ff\u3400-\u4db5\u4e00-\u9fcc\uac00-\ud7af]/;
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
  CodeMirror.version = "4.6.0";
  return CodeMirror;
});