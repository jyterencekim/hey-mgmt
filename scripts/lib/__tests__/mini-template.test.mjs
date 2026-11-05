import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MiniTemplate } from '../mini-template.mjs';

describe('MiniTemplate', () => {
  const tpl = new MiniTemplate();

  it('basic interpolation: {{name}} with { name: "world" }', () => {
    assert.equal(tpl.render('Hello {{name}}!', { name: 'world' }), 'Hello world!');
  });

  it('dot notation: {{user.name}} resolves nested property', () => {
    assert.equal(tpl.render('{{user.name}}', { user: { name: 'Alice' } }), 'Alice');
  });

  it('undefined variable resolves to empty string', () => {
    assert.equal(tpl.render('{{missing}}', {}), '');
  });

  it('for loop iterates over array', () => {
    const result = tpl.render('{% for item in items %}{{item}} {% endfor %}', { items: ['a', 'b'] });
    assert.equal(result, 'a b ');
  });

  it('for loop with empty array produces empty string', () => {
    const result = tpl.render('{% for item in items %}{{item}}{% endfor %}', { items: [] });
    assert.equal(result, '');
  });

  it('if truthy: renders body when condition is true', () => {
    assert.equal(tpl.render('{% if show %}visible{% endif %}', { show: true }), 'visible');
  });

  it('if falsy: renders nothing when condition is false', () => {
    assert.equal(tpl.render('{% if show %}visible{% endif %}', { show: false }), '');
  });

  it('if with empty array: treats empty array as falsy', () => {
    assert.equal(tpl.render('{% if items %}yes{% endif %}', { items: [] }), '');
  });

  it('array .length: {{items.length}} resolves to array length', () => {
    assert.equal(tpl.render('{{items.length}}', { items: [1, 2, 3] }), '3');
  });
});
