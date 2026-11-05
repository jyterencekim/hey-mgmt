/**
 * MiniTemplate — zero-dep template engine for prompt rendering.
 *
 * Supports:
 *   {{variable}}           — interpolation with dot notation
 *   {% for item in array %}...{% endfor %}  — loops
 *   {% if condition %}...{% endif %}        — conditionals (truthy check)
 *   .length on arrays, nested dot notation, undefined → ''
 */
export class MiniTemplate {
  /**
   * Render a template string with the given variables.
   * @param {string} template
   * @param {Record<string, unknown>} vars
   * @returns {string}
   */
  render(template, vars) {
    let result = template;
    // Process blocks depth-first (innermost first via repeated passes)
    result = this._processFor(result, vars);
    result = this._processIf(result, vars);
    result = this._interpolate(result, vars);
    return result;
  }

  // --- For loops ---

  _processFor(template, vars) {
    // Process innermost {% for %} blocks first by iterating until stable
    const FOR_RE = /\{%\s*for\s+(\w+)\s+in\s+([\w.]+)\s*%\}([\s\S]*?)\{%\s*endfor\s*%\}/g;
    let prev;
    let result = template;
    // Repeat until no more for-blocks (handles nesting)
    do {
      prev = result;
      result = result.replace(FOR_RE, (_, itemName, arrayExpr, body) => {
        const collection = this._get(vars, arrayExpr);
        if (!Array.isArray(collection) || collection.length === 0) return '';
        return collection
          .map((item) => {
            const loopVars = { ...vars, [itemName]: item };
            // Recursively handle nested blocks in the loop body
            let rendered = this._processFor(body, loopVars);
            rendered = this._processIf(rendered, loopVars);
            rendered = this._interpolate(rendered, loopVars);
            return rendered;
          })
          .join('');
      });
    } while (result !== prev);
    return result;
  }

  // --- If blocks ---

  _processIf(template, vars) {
    // Process innermost {% if %} blocks first by iterating until stable
    const IF_RE = /\{%\s*if\s+([\w.]+)\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g;
    let prev;
    let result = template;
    do {
      prev = result;
      result = result.replace(IF_RE, (_, condExpr, body) => {
        const value = this._get(vars, condExpr);
        if (!this._isTruthy(value)) return '';
        // Recursively handle nested blocks in truthy body
        let rendered = this._processFor(body, vars);
        rendered = this._processIf(rendered, vars);
        rendered = this._interpolate(rendered, vars);
        return rendered;
      });
    } while (result !== prev);
    return result;
  }

  // --- Interpolation ---

  _interpolate(template, vars) {
    return template.replace(/\{\{([\w.]+)\}\}/g, (_, expr) => {
      const value = this._get(vars, expr.trim());
      if (value === null || value === undefined) return '';
      if (Array.isArray(value)) return value.join(', ');
      return String(value);
    });
  }

  // --- Property access ---

  /**
   * Resolve a dot-notation expression against vars.
   * Supports .length on arrays. Returns undefined for missing paths.
   */
  _get(vars, expr) {
    const parts = expr.split('.');
    let current = vars;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (part === 'length' && Array.isArray(current)) {
        current = current.length;
      } else if (typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, part)) {
        current = current[part];
      } else if (typeof current === 'object' && current !== null) {
        // Allow access even without own-property (e.g. class instances)
        current = current[part];
      } else {
        return undefined;
      }
    }
    return current;
  }

  /**
   * Truthy check: false for null, undefined, false, 0, '', empty array.
   */
  _isTruthy(value) {
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.length > 0;
    return Boolean(value);
  }
}
