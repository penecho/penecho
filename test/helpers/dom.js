"use strict";
// linkedom for tests: require it from here, never from "linkedom" itself (test/test-safety.test.js checks). A DOM node drags
// in its whole document, and a failing assert that printed one froze the Mac (PE-927). Here a failing assert with a node in
// it fails at once with a short message (safety.js), and nodes print short: <div#id.class>, #document, #text "...".
const util = require("node:util");
const linkedom = require("linkedom");
const safety = require("./safety.js");

const quote = text => JSON.stringify(text.length > 40 ? `${text.slice(0, 40)}…` : text);
function label(node) {
  switch (node.nodeType) {
    case 1: {
      const id = node.getAttribute("id"), classes = String(node.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean);
      return `<${node.localName}${id ? `#${id}` : ""}${classes.map(name => `.${name}`).join("")}>`;
    }
    case 2: return `@${node.name}=${quote(String(node.value))}`;
    case 3: return `#text ${quote(String(node.data))}`;
    case 4: return `#cdata ${quote(String(node.data))}`;
    case 8: return `#comment ${quote(String(node.data))}`;
    case 9: return "#document";
    case 10: return `<!DOCTYPE ${node.name}>`;
    case 11: return "#document-fragment";
    default: return `#node(${node.nodeType})`;
  }
}

// Every linkedom node, of any document, inherits from one Node class.
let proto = Object.getPrototypeOf(linkedom.parseHTML("<html></html>").document);
while (proto && proto.constructor?.name !== "Node") proto = Object.getPrototypeOf(proto);
if (!proto) throw new Error("linkedom's Node class was not found: test/helpers/dom.js needs updating");
const NodeClass = proto.constructor;
Object.defineProperty(proto, util.inspect.custom, { configurable:true, value() { try { return label(this); } catch { return "#node"; } } });
safety.shortWhen(value => value instanceof NodeClass);

module.exports = linkedom;
