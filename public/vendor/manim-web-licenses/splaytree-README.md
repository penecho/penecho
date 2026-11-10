# Fast splay tree [![npm version](https://badge.fury.io/js/splaytree.svg)](https://badge.fury.io/js/splaytree) [![codecov](https://codecov.io/gh/w8r/splay-tree/branch/master/graph/badge.svg)](https://codecov.io/gh/w8r/splay-tree)

[Splay-tree](https://en.wikipedia.org/wiki/Splay_tree): **[fast](#benchmarks)**(non-recursive) and **simple**(< 1000 lines of code)
Implementation is adapted directly from Wikipedia with the same API as [w8r/avl](https://github.com/w8r/avl), to run the benchmarks against other trees.

This tree is based on **top-down** splaying algorithm by D.Sleator. It supports

- splitting, merging
- updating of the keys
- bulk loading of the items into an empty or non-empty tree
- insertion with duplicates or no duplicates
- lookup without splaying

![Splay-tree](https://i.stack.imgur.com/CNSAZ.png)

| Operation | Average      | Worst case             |
| --------- | ------------ | ---------------------- |
| Space     | **O(n)**     | **O(n)**               |
| Search    | **O(log n)** | **amortized O(log n)** |
| Insert    | **O(log n)** | **amortized O(log n)** |
| Delete    | **O(log n)** | **amortized O(log n)** |

## Install

```shell
npm i -S splaytree
```

```js
import SplayTree from "splaytree";
const tree = new SplayTree();
```

Or get it from CDN

```html
<script src="https://unpkg.com/splaytree"></script>
<script>
  var tree = new SplayTree();
  ...
</script>
```

Or use the compiled version 'dist/splaytree.umd.cjs'.

[Try it in your browser](https://npm.runkit.com/splaytree)

## API

- `new SplayTree([comparator])`, where `comparator` is optional comparison function
- `tree.insert(key:any, [data:any]):Node` - Insert item, allow duplicate keys
- `tree.add(key:any, [data:any]):Node` - Insert item if it is not present
- `tree.remove(key:any)` - Remove item
- `tree.find(key):Node|Null` - Return node by its key
- `tree.findStatic(key):Node|Null` - Return node by its key (doesn't re-balance the tree)
- `tree.at(index:Number):Node|Null` - Return node by its index in sorted order of keys
- `tree.contains(key):Boolean` - Whether a node with the given key is in the tree
- `tree.forEach(function(node) {...}):Tree` In-order traversal
- `tree.keys():Array<key>` - Returns the array of keys in order
- `tree.values():Array<*>` - Returns the array of data fields in order
- `tree.range(lo, high, function(node) {} [, context]):Tree` - Walks the range of keys in order. Stops, if the visitor function returns a non-zero value.
- `tree.pop():Node` - Removes smallest node
- `tree.min():key` - Returns min key
- `tree.max():key` - Returns max key
- `tree.minNode():Node` - Returns the node with smallest key
- `tree.maxNode():Node` - Returns the node with highest key
- `tree.prev(node):Node` - Predecessor node
- `tree.next(node):Node` - Successor node
- `tree.load(keys:Array<*>, [values:Array<*>][,presort=false]):Tree` - Bulk-load items. It expects values and keys to be sorted, but if `presort` is `true`, it will sort keys and values using the comparator(in-place, your arrays are going to be altered).

**Comparator**

`function(a:key,b:key):Number` - Comparator function between two keys, it returns

- `0` if the keys are equal
- `<0` if `a < b`
- `>0` if `a > b`

The comparator function is extremely important, in case of errors you might end
up with a wrongly constructed tree or would not be able to retrieve your items.
It is crucial to test the return values of your `comparator(a,b)` and `comparator(b,a)`
to make sure it's working correctly, otherwise you may have bugs that are very
unpredictable and hard to catch.

**Duplicate keys**

- `insert()` method allows duplicate keys. This can be useful in certain applications (example: overlapping
  points in 2D).
- `add()` method will not allow duplicate keys - if key is already present in the tree, no new node is created

## Example

```js
import Tree from "splaytree";

const t = new Tree();
t.insert(5);
t.insert(-10);
t.insert(0);
t.insert(33);
t.insert(2);

console.log(t.keys()); // [-10, 0, 2, 5, 33]
console.log(t.size); // 5
console.log(t.min()); // -10
console.log(t.max()); // -33

t.remove(0);
console.log(t.size); // 4
```

**Custom comparator (reverse sort)**

```js
import Tree from "splaytree";

const t = new Tree((a, b) => b - a);
t.insert(5);
t.insert(-10);
t.insert(0);
t.insert(33);
t.insert(2);

console.log(t.keys()); // [33, 5, 2, 0, -10]
```

**Bulk insert**

```js
import Tree from "splaytree";

const t = new Tree();
t.load([3, 2, -10, 20], ["C", "B", "A", "D"]);
console.log(t.keys()); // [-10, 2, 3, 20]
console.log(t.values()); // ['A', 'B', 'C', 'D']
```

## Benchmarks

```shell
npm run benchmark
```

```
Insert (x1000)
 - Bintrees RB x 5,779 ops/sec ±1.37% (85 runs sampled) mean 0.173ms
 - Splay (current) x 9,264 ops/sec ±2.70% (88 runs sampled) mean 0.108ms
 - AVL x 7,459 ops/sec ±1.07% (91 runs sampled) mean 0.134ms
- Fastest is Splay (current)

Random read (x1000)
 - Bintrees RB x 19,317 ops/sec ±0.52% (90 runs sampled) mean 0.052ms
 - Splay (current) x 7,635 ops/sec ±0.92% (91 runs sampled) mean 0.131ms
 - Splay (current) - static x 16,350 ops/sec ±0.75% (87 runs sampled) mean 0.061ms
 - AVL x 15,782 ops/sec ±0.57% (91 runs sampled) mean 0.063ms
- Fastest is Bintrees RB

Remove (x1000)
 - Bintrees RB x 195,282 ops/sec ±0.85% (90 runs sampled) mean 0.005ms
 - Splay (current) x 364,630 ops/sec ±6.05% (87 runs sampled) mean 0.003ms
 - AVL x 95,946 ops/sec ±0.76% (93 runs sampled) mean 0.010ms
- Fastest is Splay (current)

Bulk-load (x10000)
 - 1 by 1 x 266 ops/sec ±1.58% (83 runs sampled) mean 3.755ms
 - bulk load (build) x 287 ops/sec ±3.02% (76 runs sampled) mean 3.487ms
- Fastest is bulk load (build)

Bulk-add (x1000) to 1000
 - 1 by 1 x 2,859 ops/sec ±3.35% (77 runs sampled) mean 0.350ms
 - bulk add (rebuild) x 3,755 ops/sec ±2.67% (67 runs sampled) mean 0.266ms
- Fastest is bulk add (rebuild)

Bulk-remove-insert (10%) of 10000
 - 1 by 1 x 771 ops/sec ±4.31% (68 runs sampled) mean 1.297ms
 - bulk add (rebuild) x 706 ops/sec ±1.12% (88 runs sampled) mean 1.416ms
- Fastest is 1 by 1

Bulk-update (10%) of 10000
 - 1 by 1 x 717 ops/sec ±1.96% (79 runs sampled) mean 1.394ms
 - split-merge x 705 ops/sec ±1.68% (85 runs sampled) mean 1.419ms
- Fastest is 1 by 1
```

Adding google closure library to the benchmark is, of course, unfair, cause the
node.js version of it is not optimized by the compiler, but in this case it
plays the role of straight-forward robust implementation.

## Develop

```shell
npm i
npm t
npm run build
```

## TODO

- [ ] try and add parent fields for efficient `.prev()` and `.next()`, or iterators

## License

The MIT License (MIT)

Copyright (c) 2019 Alexander Milevski <info@w8r.name>

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
