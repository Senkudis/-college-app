const mongoose = require("mongoose");
const express = require("express");
const http = require("http");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cron = require("node-cron");

// Mock node-cron to avoid keeping event loop alive in tests
cron.schedule = function(expression, func, options) {
  return {
    start: () => {},
    stop: () => {},
    destroy: () => {}
  };
};

const memoryStore = {};
const JWT_SECRET = process.env.JWT_SECRET || "test_jwt_secret_key_1234567890";

// Helper to get store
function getStore(modelName) {
  if (!memoryStore[modelName]) {
    memoryStore[modelName] = [];
  }
  return memoryStore[modelName];
}

// Reset store
function resetDB() {
  for (const key of Object.keys(memoryStore)) {
    memoryStore[key] = [];
  }
}

/* يقرأ قيمة مسار قد يكون منقّطاً ("students.student") بدلالة MongoDB:
   المرور بمصفوفة يوزّع بقية المسار على عناصرها، والنتيجة مصفوفة القيم
   الورقية — فيكفي تطابق أحدها. المسار البسيط يعود كما هو. */
function resolvePath(item, key) {
  if (!key.includes('.')) return item[key];

  let current = [item];
  for (const segment of key.split('.')) {
    const next = [];
    for (const node of current) {
      if (node === null || node === undefined) continue;
      if (Array.isArray(node)) {
        for (const entry of node) {
          if (entry && entry[segment] !== undefined) next.push(entry[segment]);
        }
      } else if (node[segment] !== undefined) {
        next.push(node[segment]);
      }
    }
    current = next;
  }
  // مصفوفة مسطّحة من القيم الورقية؛ undefined إن لم يوجد المسار إطلاقاً
  const flat = current.flat(Infinity);
  return flat.length ? flat : undefined;
}

// Match filters
function matchFilter(item, filter, modelName) {
  if (!filter) return true;

  // Handle root $or operator
  if (filter.$or && Array.isArray(filter.$or)) {
    const match = filter.$or.some(subFilter => matchFilter(item, subFilter, modelName));
    if (!match) return false;
  }

  // Handle root $and operator
  if (filter.$and && Array.isArray(filter.$and)) {
    const match = filter.$and.every(subFilter => matchFilter(item, subFilter, modelName));
    if (!match) return false;
  }

  for (const key of Object.keys(filter)) {
    if (key === '$or' || key === '$and') continue;
    const val = filter[key];
    
    // In User model, soft delete: if filter doesn't specify deletedAt, we filter out soft deleted items.
    if (modelName === 'User' && key === 'deletedAt' && val === null) {
      if (item.deletedAt !== null && item.deletedAt !== undefined) return false;
      continue;
    }

    /* المسارات المنقّطة مثل "students.student" كانت تُقرأ عبر item[key]
       حرفياً فلا تطابق شيئاً أبداً — رغم أن كوداً إنتاجياً يعتمد عليها في
       الحضور والتقارير. نحلّها بدلالة MongoDB: إن مرّ المسار بمصفوفة،
       يكفي أن يطابق أحد عناصرها. */
    const resolved = resolvePath(item, key);

    const isOperatorObj = val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date) && !(val instanceof RegExp) && Object.keys(val).some(k => k.startsWith('$'));
    if (isOperatorObj) {
      const operators = Object.keys(val);
      for (const op of operators) {
        if (op === '$ne') {
          const itemVal = resolved;
          if (Array.isArray(itemVal)) {
            if (itemVal.map(x => x.toString()).includes(val['$ne'].toString())) return false;
          } else {
            const itemStr = itemVal !== null && itemVal !== undefined ? itemVal.toString() : '';
            const valStr = val['$ne'] !== null && val['$ne'] !== undefined ? val['$ne'].toString() : '';
            if (itemStr === valStr) return false;
          }
        } else if (op === '$gt' || op === '$gte') {
          const itemVal = resolved ? new Date(resolved).getTime() : 0;
          const compareVal = new Date(val[op]).getTime();
          if (op === '$gt' && itemVal <= compareVal) return false;
          if (op === '$gte' && itemVal < compareVal) return false;
        } else if (op === '$lt' || op === '$lte') {
          const itemVal = resolved ? new Date(resolved).getTime() : 0;
          const compareVal = new Date(val[op]).getTime();
          if (op === '$lt' && itemVal >= compareVal) return false;
          if (op === '$lte' && itemVal > compareVal) return false;
        } else if (op === '$in') {
          const arr = val['$in'];
          const itemVal = resolved;
          if (Array.isArray(itemVal)) {
            const itemStrs = itemVal.map(x => x.toString());
            const match = arr.some(x => itemStrs.includes(x.toString()));
            if (!match) return false;
          } else {
            const itemStr = itemVal ? itemVal.toString() : '';
            if (!arr.map(x => x.toString()).includes(itemStr)) return false;
          }
        } else if (op === '$size') {
          const itemVal = resolved;
          if (!Array.isArray(itemVal) || itemVal.length !== val['$size']) return false;
        } else if (op === '$exists') {
          const exists = resolved !== undefined;
          if (Boolean(val['$exists']) !== exists) return false;
        } else if (op === '$nin') {
          const arr = val['$nin'];
          const itemVal = resolved;
          if (Array.isArray(itemVal)) {
            const itemStrs = itemVal.map(x => x.toString());
            const match = arr.some(x => itemStrs.includes(x.toString()));
            if (match) return false;
          } else {
            const itemStr = itemVal ? itemVal.toString() : '';
            if (arr.map(x => x.toString()).includes(itemStr)) return false;
          }
        } else if (op === '$regex') {
          const pattern = val['$regex'];
          const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, val['$options'] || '');
          const itemStr = resolved ? resolved.toString() : '';
          if (!regex.test(itemStr)) return false;
        } else {
          if (JSON.stringify(resolved) !== JSON.stringify(val)) return false;
        }
      }
    } else if (val instanceof RegExp) {
      const itemStr = resolved ? resolved.toString() : '';
      if (!val.test(itemStr)) return false;
    } else if (Array.isArray(resolved) && !Array.isArray(val)) {
      const valStr = val !== null && val !== undefined ? val.toString() : '';
      if (!resolved.map(x => x !== null && x !== undefined ? x.toString() : '').includes(valStr)) {
        return false;
      }
    } else {
      const itemVal = resolved;
      const itemStr = itemVal !== null && itemVal !== undefined ? itemVal.toString() : '';
      const valStr = val !== null && val !== undefined ? val.toString() : '';
      if (itemStr !== valStr && JSON.stringify(itemVal) !== JSON.stringify(val)) {
        return false;
      }
    }
  }
  return true;
}

// Chainable query helper
class MockQuery {
  constructor(promise) {
    this.promise = promise;
  }
  populate(path) {
    this.promise = this.promise.then(async (result) => {
      if (!result) return result;
      if (Array.isArray(result)) {
        for (const doc of result) {
          if (doc && typeof doc.populate === 'function') {
            await doc.populate(path);
          }
        }
      } else if (typeof result.populate === 'function') {
        await result.populate(path);
      }
      return result;
    });
    return this;
  }
  select() { return this; }
  sort(arg) {
    this.promise = this.promise.then(result => {
      if (!Array.isArray(result)) return result;
      const sorted = [...result];
      if (typeof arg === 'object') {
        const key = Object.keys(arg)[0];
        const order = arg[key];
        sorted.sort((a, b) => {
          const valA = a[key] !== undefined ? a[key] : '';
          const valB = b[key] !== undefined ? b[key] : '';
          if (valA < valB) return order === -1 ? 1 : -1;
          if (valA > valB) return order === -1 ? -1 : 1;
          return 0;
        });
      } else if (typeof arg === 'string') {
        const isDescending = arg.startsWith('-');
        const key = isDescending ? arg.substring(1) : arg;
        sorted.sort((a, b) => {
          const valA = a[key] !== undefined ? a[key] : '';
          const valB = b[key] !== undefined ? b[key] : '';
          if (valA < valB) return isDescending ? 1 : -1;
          if (valA > valB) return isDescending ? -1 : 1;
          return 0;
        });
      }
      return sorted;
    });
    return this;
  }
  limit(n) {
    this.promise = this.promise.then(result => {
      if (Array.isArray(result)) {
        return result.slice(0, n);
      }
      return result;
    });
    return this;
  }
  skip(n) {
    this.promise = this.promise.then(result => {
      if (Array.isArray(result)) {
        return result.slice(n);
      }
      return result;
    });
    return this;
  }
  lean() { return this; }
  where() { return this; }
  // distinct(field): القيم الفريدة للحقل في نتيجة الاستعلام
  distinct(field) {
    this.promise = this.promise.then(result => {
      const list = Array.isArray(result) ? result : (result ? [result] : []);
      const seen = new Map();
      for (const doc of list) {
        const raw = doc && typeof doc.toObject === 'function' ? doc.toObject() : doc;
        let v = resolvePath(raw || {}, field);
        for (const one of (Array.isArray(v) ? v : [v])) {
          if (one === undefined || one === null) continue;
          const k = String(one);
          if (!seen.has(k)) seen.set(k, one);
        }
      }
      return [...seen.values()];
    });
    return this;
  }
  async exec() {
    return this.promise;
  }
  then(onfulfilled, onrejected) {
    return this.promise.then(onfulfilled, onrejected);
  }
}

// Update applicator
function applyUpdate(item, update, Model) {
  if (Model.modelName === 'User') {
    const updateObj = update.$set || update;
    if (updateObj.password) {
      const salt = bcrypt.genSaltSync(10);
      updateObj.password = bcrypt.hashSync(updateObj.password, salt);
      updateObj.firstLogin = true;
      updateObj.passwordChangedAt = Date.now();
    }
  }

  if (update.$set) {
    for (const key of Object.keys(update.$set)) {
      item[key] = update.$set[key];
    }
  } else if (!update.$push && !update.$pull && !update.$addToSet && !update.$inc && !update.$unset) {
    for (const key of Object.keys(update)) {
      if (!key.startsWith('$')) {
        item[key] = update[key];
      }
    }
  }
  
  if (update.$unset) {
    for (const key of Object.keys(update.$unset)) {
      delete item[key];
    }
  }

  if (update.$inc) {
    for (const key of Object.keys(update.$inc)) {
      item[key] = (item[key] || 0) + update.$inc[key];
    }
  }

  if (update.$push) {
    for (const key of Object.keys(update.$push)) {
      if (!Array.isArray(item[key])) item[key] = [];
      const val = update.$push[key];
      if (val && typeof val === 'object' && val.$each) {
        item[key].push(...val.$each);
      } else {
        item[key].push(val);
      }
    }
  }

  if (update.$pull) {
    for (const key of Object.keys(update.$pull)) {
      if (Array.isArray(item[key])) {
        const val = update.$pull[key];
        item[key] = item[key].filter(x => {
          if (x && val && (typeof x === 'object' || typeof val === 'object')) {
            return x.toString() !== val.toString();
          }
          return x !== val;
        });
      }
    }
  }

  if (update.$addToSet) {
    for (const key of Object.keys(update.$addToSet)) {
      if (!Array.isArray(item[key])) item[key] = [];
      const val = update.$addToSet[key];
      if (val && typeof val === 'object' && val.$each) {
        for (const v of val.$each) {
          const valStr = v.toString();
          if (!item[key].map(x => x.toString()).includes(valStr)) {
            item[key].push(v);
          }
        }
      } else {
        const valStr = val.toString();
        if (!item[key].map(x => x.toString()).includes(valStr)) {
          item[key].push(val);
        }
      }
    }
  }
  
  item.updatedAt = new Date();
}

// Override Model static operations
const ModelOverrides = {
  find(filter) {
    const modelName = this.modelName;
    const store = getStore(modelName);
    const matched = store.filter(item => {
      if (modelName === 'User' && (!filter || !('deletedAt' in filter))) {
        if (item.deletedAt !== null && item.deletedAt !== undefined) return false;
      }
      return matchFilter(item, filter, modelName);
    }).map(item => new this(item));
    return new MockQuery(Promise.resolve(matched));
  },
  
  findOne(filter) {
    const modelName = this.modelName;
    const store = getStore(modelName);
    const item = store.find(item => {
      if (modelName === 'User' && (!filter || !('deletedAt' in filter))) {
        if (item.deletedAt !== null && item.deletedAt !== undefined) return false;
      }
      return matchFilter(item, filter, modelName);
    });
    const result = item ? new this(item) : null;
    return new MockQuery(Promise.resolve(result));
  },
  
  findById(id) {
    if (!id) return new MockQuery(Promise.resolve(null));
    const modelName = this.modelName;
    const store = getStore(modelName);
    const item = store.find(item => item._id.toString() === id.toString());
    const result = item ? new this(item) : null;
    return new MockQuery(Promise.resolve(result));
  },
  
  async create(doc) {
    if (Array.isArray(doc)) {
      const instances = [];
      for (const d of doc) {
        const instance = new this(d);
        await instance.save();
        instances.push(instance);
      }
      return instances;
    } else {
      const instance = new this(doc);
      await instance.save();
      return instance;
    }
  },
  
  async exists(filter) {
    const doc = await this.findOne(filter);
    return doc ? { _id: doc._id } : null;
  },

  async updateOne(filter, update) {
    const modelName = this.modelName;
    const store = getStore(modelName);
    const item = store.find(item => {
      if (modelName === 'User' && (!filter || !('deletedAt' in filter))) {
        if (item.deletedAt !== null && item.deletedAt !== undefined) return false;
      }
      return matchFilter(item, filter, modelName);
    });
    
    if (item) {
      applyUpdate(item, update, this);
    }
    return { n: item ? 1 : 0, nModified: item ? 1 : 0, ok: 1 };
  },
  
  async updateMany(filter, update) {
    const modelName = this.modelName;
    const store = getStore(modelName);
    const matched = store.filter(item => {
      if (modelName === 'User' && (!filter || !('deletedAt' in filter))) {
        if (item.deletedAt !== null && item.deletedAt !== undefined) return false;
      }
      return matchFilter(item, filter, modelName);
    });
    
    for (const item of matched) {
      applyUpdate(item, update, this);
    }
    return { n: matched.length, nModified: matched.length, ok: 1 };
  },
  
  async deleteOne(filter) {
    const modelName = this.modelName;
    const store = getStore(modelName);
    const index = store.findIndex(item => {
      if (modelName === 'User' && (!filter || !('deletedAt' in filter))) {
        if (item.deletedAt !== null && item.deletedAt !== undefined) return false;
      }
      return matchFilter(item, filter, modelName);
    });
    if (index >= 0) {
      store.splice(index, 1);
      return { deletedCount: 1 };
    }
    return { deletedCount: 0 };
  },
  
  async deleteMany(filter) {
    const modelName = this.modelName;
    const store = getStore(modelName);
    let deletedCount = 0;
    for (let i = store.length - 1; i >= 0; i--) {
      const item = store[i];
      if (modelName === 'User' && (!filter || !('deletedAt' in filter))) {
        if (item.deletedAt !== null && item.deletedAt !== undefined) continue;
      }
      if (matchFilter(item, filter, modelName)) {
        store.splice(i, 1);
        deletedCount++;
      }
    }
    return { deletedCount };
  },
  
  findByIdAndUpdate(id, update, options = {}) {
    if (!id) return new MockQuery(Promise.resolve(null));
    const modelName = this.modelName;
    const store = getStore(modelName);
    const item = store.find(item => item._id.toString() === id.toString());
    if (item) {
      applyUpdate(item, update, this);
    }
    const result = item ? new this(item) : null;
    return new MockQuery(Promise.resolve(result));
  },
  
  // findOneAndUpdate مع upsert — كان غائباً فمسار تسجيل الحضور يسقط بـ500 في الاختبار
  findOneAndUpdate(filter, update, options = {}) {
    const Model = this;
    const store = getStore(this.modelName);
    const item = store.find(it => matchFilter(it, filter, Model.modelName));
    if (item) {
      applyUpdate(item, update, Model);
      return new MockQuery(Promise.resolve(new Model(item)));
    }
    if (!options.upsert) return new MockQuery(Promise.resolve(null));
    const plain = {};
    for (const [k, v] of Object.entries(filter || {})) if (!k.startsWith("$") && (v === null || typeof v !== "object" || v instanceof mongoose.Types.ObjectId)) plain[k] = v;
    const fields = Object.fromEntries(Object.entries(update || {}).filter(([k]) => !k.startsWith("$")));
    const doc = new Model({ ...plain, ...(update?.$setOnInsert || {}), ...(update?.$set || {}), ...fields });
    return new MockQuery(doc.save().then(() => doc));
  },

  findByIdAndDelete(id) {
    if (!id) return new MockQuery(Promise.resolve(null));
    const modelName = this.modelName;
    const store = getStore(modelName);
    const index = store.findIndex(item => item._id.toString() === id.toString());
    let result = null;
    if (index >= 0) {
      result = new this(store[index]);
      store.splice(index, 1);
    }
    return new MockQuery(Promise.resolve(result));
  },
  
  findOneAndDelete(filter) {
    const modelName = this.modelName;
    const store = getStore(modelName);
    const index = store.findIndex(item => {
      if (modelName === 'User' && (!filter || !('deletedAt' in filter))) {
        if (item.deletedAt !== null && item.deletedAt !== undefined) return false;
      }
      return matchFilter(item, filter, modelName);
    });
    let result = null;
    if (index >= 0) {
      result = new this(store[index]);
      store.splice(index, 1);
    }
    return new MockQuery(Promise.resolve(result));
  },
  
  countDocuments(filter) {
    const modelName = this.modelName;
    const store = getStore(modelName);
    const matched = store.filter(item => {
      if (modelName === 'User' && (!filter || !('deletedAt' in filter))) {
        if (item.deletedAt !== null && item.deletedAt !== undefined) return false;
      }
      return matchFilter(item, filter, modelName);
    });
    return new MockQuery(Promise.resolve(matched.length));
  },
  
  estimatedDocumentCount() {
    const modelName = this.modelName;
    const store = getStore(modelName);
    return new MockQuery(Promise.resolve(store.length));
  },

  aggregate(pipeline) {
    const modelName = this.modelName;
    return new MockQuery(Promise.resolve().then(() => runAggregate(modelName, pipeline)));
  }
};

const compiledModels = {};

/* ===== محاكاة aggregate مبسّطة =====
   تدعم المراحل والتعابير التي تستخدمها المسارات فعلاً: $match و$unwind و$group
   ($sum/$avg/$first/$push/$max/$min) و$lookup و$sort و$limit و$skip و$project و$count،
   والتعابير "$path" و$cond و$eq و$ne و$ifNull و$subtract و$add و$max و$min و$map و$size. */
function aggClone(v) {
  if (v === null || v === undefined) return v;
  if (typeof v.toObject === 'function') return v.toObject();
  return v;
}
function aggEval(expr, doc, vars = {}) {
  if (typeof expr === 'string') {
    if (expr.startsWith('$$')) {
      const [name, ...rest] = expr.slice(2).split('.');
      let val = vars[name];
      return rest.length ? resolvePath(val || {}, rest.join('.')) : val;
    }
    if (expr.startsWith('$')) return resolvePath(doc || {}, expr.slice(1));
    return expr;
  }
  if (Array.isArray(expr)) return expr.map(e => aggEval(e, doc, vars));
  if (expr && typeof expr === 'object' && !(expr instanceof Date) && !expr._bsontype) {
    const keys = Object.keys(expr);
    const op = keys[0];
    if (keys.length === 1 && op.startsWith('$')) {
      const arg = expr[op];
      const ev = a => aggEval(a, doc, vars);
      const num = v => (Array.isArray(v) ? v.reduce((s, x) => s + (Number(x) || 0), 0) : (Number(v) || 0));
      switch (op) {
        case '$cond': {
          const [cond, a, b] = Array.isArray(arg) ? arg : [arg.if, arg.then, arg.else];
          return ev(cond) ? ev(a) : ev(b);
        }
        case '$eq': { const [a, b] = arg.map(ev); return String(a) === String(b); }
        case '$ne': { const [a, b] = arg.map(ev); return String(a) !== String(b); }
        case '$gt': { const [a, b] = arg.map(ev); return a > b; }
        case '$gte': { const [a, b] = arg.map(ev); return a >= b; }
        case '$lt': { const [a, b] = arg.map(ev); return a < b; }
        case '$lte': { const [a, b] = arg.map(ev); return a <= b; }
        case '$and': return arg.every(x => ev(x));
        case '$or': return arg.some(x => ev(x));
        case '$ifNull': { const [a, b] = arg; const v = ev(a); return v === null || v === undefined ? ev(b) : v; }
        case '$subtract': { const [a, b] = arg.map(ev); return num(a) - num(b); }
        case '$add': return arg.map(ev).reduce((s, x) => s + num(x), 0);
        case '$multiply': return arg.map(ev).reduce((s, x) => s * num(x), 1);
        case '$divide': { const [a, b] = arg.map(ev); return num(b) ? num(a) / num(b) : null; }
        case '$max': { const vals = (Array.isArray(arg) ? arg.map(ev) : [ev(arg)]).flat().filter(v => v !== null && v !== undefined); return vals.length ? vals.reduce((m, x) => (x > m ? x : m)) : null; }
        case '$min': { const vals = (Array.isArray(arg) ? arg.map(ev) : [ev(arg)]).flat().filter(v => v !== null && v !== undefined); return vals.length ? vals.reduce((m, x) => (x < m ? x : m)) : null; }
        case '$sum': return num(ev(arg));
        case '$size': { const v = ev(arg); return Array.isArray(v) ? v.length : 0; }
        case '$map': {
          const input = ev(arg.input) || [];
          const as = arg.as || 'this';
          return (Array.isArray(input) ? input : [input]).map(item => aggEval(arg.in, doc, { ...vars, [as]: item }));
        }
        case '$toString': return String(ev(arg));
        default: return undefined;
      }
    }
    const out = {};
    for (const k of keys) out[k] = aggEval(expr[k], doc, vars);
    return out;
  }
  return expr;
}
function aggSetPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] === undefined || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}
function aggCollectionStore(collection) {
  const wanted = String(collection).toLowerCase();
  const name = Object.keys(compiledModels).find(n => {
    const m = compiledModels[n];
    const coll = (m.collection && m.collection.name) || '';
    return coll.toLowerCase() === wanted || (n.toLowerCase() + 's') === wanted || n.toLowerCase() === wanted;
  });
  return name ? getStore(name) : [];
}
function runAggregate(modelName, pipeline) {
  let docs = getStore(modelName).map(item => ({ ...aggClone(item) }));
  if (modelName === 'User') docs = docs.filter(d => d.deletedAt === null || d.deletedAt === undefined);
  for (const stage of pipeline || []) {
    const op = Object.keys(stage)[0];
    const arg = stage[op];
    if (op === '$match') {
      docs = docs.filter(d => matchFilter(d, arg, modelName));
    } else if (op === '$unwind') {
      const path = (typeof arg === 'string' ? arg : arg.path).replace(/^\$/, '');
      const keep = typeof arg === 'object' && arg.preserveNullAndEmptyArrays;
      const out = [];
      for (const d of docs) {
        const v = resolvePath(d, path);
        const parts = path.split('.');
        const arr = path.includes('.') ? v : d[path];
        if (Array.isArray(arr) && arr.length) {
          for (const el of arr) { const copy = { ...d }; aggSetPath(copy, path, aggClone(el)); out.push(copy); }
        } else if (keep) {
          out.push({ ...d });
        }
      }
      docs = out;
    } else if (op === '$group') {
      const groups = new Map();
      for (const d of docs) {
        const id = aggEval(arg._id, d);
        const key = JSON.stringify(id === undefined ? null : (id && id.toString && typeof id === 'object' && !Array.isArray(id) && id._bsontype ? id.toString() : id));
        if (!groups.has(key)) groups.set(key, { _id: id === undefined ? null : id, __n: {}, __docs: [] });
        groups.get(key).__docs.push(d);
      }
      docs = [...groups.values()].map(g => {
        const out = { _id: g._id };
        for (const [field, acc] of Object.entries(arg)) {
          if (field === '_id') continue;
          const accOp = Object.keys(acc)[0];
          const vals = g.__docs.map(d => aggEval(acc[accOp], d));
          if (accOp === '$sum') out[field] = vals.reduce((s, v) => s + (Number(Array.isArray(v) ? v.reduce((a, b) => a + (Number(b) || 0), 0) : v) || 0), 0);
          else if (accOp === '$avg') { const n = vals.filter(v => typeof v === 'number'); out[field] = n.length ? n.reduce((a, b) => a + b, 0) / n.length : null; }
          else if (accOp === '$first') out[field] = vals[0];
          else if (accOp === '$last') out[field] = vals[vals.length - 1];
          else if (accOp === '$push') out[field] = vals;
          else if (accOp === '$addToSet') out[field] = [...new Map(vals.map(v => [String(v), v])).values()];
          else if (accOp === '$max') out[field] = vals.reduce((m, v) => (m === undefined || v > m ? v : m), undefined);
          else if (accOp === '$min') out[field] = vals.reduce((m, v) => (m === undefined || v < m ? v : m), undefined);
        }
        return out;
      });
    } else if (op === '$lookup') {
      const foreign = aggCollectionStore(arg.from).map(aggClone);
      docs = docs.map(d => {
        const local = resolvePath(d, arg.localField);
        const locals = (Array.isArray(local) ? local : [local]).map(String);
        return { ...d, [arg.as]: foreign.filter(f => { const fv = resolvePath(f, arg.foreignField); return (Array.isArray(fv) ? fv : [fv]).some(x => locals.includes(String(x))); }) };
      });
    } else if (op === '$sort') {
      const entries = Object.entries(arg);
      docs.sort((a, b) => {
        for (const [k, dir] of entries) {
          const va = resolvePath(a, k), vb = resolvePath(b, k);
          if (va < vb) return -dir;
          if (va > vb) return dir;
        }
        return 0;
      });
    } else if (op === '$limit') {
      docs = docs.slice(0, arg);
    } else if (op === '$skip') {
      docs = docs.slice(arg);
    } else if (op === '$count') {
      docs = [{ [arg]: docs.length }];
    } else if (op === '$project' || op === '$addFields' || op === '$set') {
      docs = docs.map(d => {
        const includeOnly = op === '$project' && Object.values(arg).some(v => v === 1 || v === true);
        const out = op === '$project' ? (includeOnly ? { _id: d._id } : { ...d }) : { ...d };
        for (const [k, v] of Object.entries(arg)) {
          if (v === 0 || v === false) { delete out[k]; continue; }
          aggSetPath(out, k, (v === 1 || v === true) ? resolvePath(d, k) : aggEval(v, d));
        }
        return out;
      });
    }
  }
  return docs;
}


// Monkeypatch mongoose.model compilation
mongoose.model = function(name, schema) {
  if (!schema) {
    if (!compiledModels[name]) {
      throw new Error(`Model ${name} is not defined`);
    }
    return compiledModels[name];
  }
  
  if (compiledModels[name]) {
    return compiledModels[name];
  }

  const modelClass = class {
    constructor(data = {}) {
      if (schema && schema.paths) {
        for (const path of Object.keys(schema.paths)) {
          const pathObj = schema.paths[path];
          if (data[path] === undefined) {
            if (pathObj.defaultValue !== undefined) {
              if (typeof pathObj.defaultValue === 'function') {
                this[path] = pathObj.defaultValue();
              } else {
                this[path] = pathObj.defaultValue;
              }
            } else if (pathObj.instance === 'Array' || (pathObj.caster && pathObj.caster.instance)) {
              this[path] = [];
            }
          }
        }
      }
      
      Object.assign(this, data);
      
      if (!this._id) {
        this._id = new mongoose.Types.ObjectId().toString();
        this.isNew = true;
      } else {
        this.isNew = false;
      }
    }

    isModified(path) {
      return true;
    }

    /* يفحص قيود المخطط لا الحقول المطلوبة وحدها.
       كان الاكتفاء بـ required يجعل المجموعة تمرّ على كود يفشل حتماً في
       الإنتاج: قيمة خارج enum (مثل target:'custom') كانت تُحفظ هنا بلا
       اعتراض بينما ترفضها Mongoose الحقيقية. */
    async validate() {
      if (!schema || !schema.paths) return;

      const checkOne = (label, pathObj, value) => {
        const opts = (pathObj && pathObj.options) || {};

        // enum — يقبل المصفوفة المباشرة أو { values: [...] }
        const enumValues = Array.isArray(opts.enum)
          ? opts.enum
          : (opts.enum && Array.isArray(opts.enum.values) ? opts.enum.values : null);
        if (enumValues && value !== undefined && value !== null && !enumValues.includes(value)) {
          throw new Error(`${label}: \`${value}\` is not a valid enum value for path \`${label}\`.`);
        }

        const limit = (opt) => (Array.isArray(opt) ? opt[0] : opt);

        if (typeof value === 'number') {
          const min = limit(opts.min);
          const max = limit(opts.max);
          if (min !== undefined && value < min) throw new Error(`${label} (${value}) is less than minimum allowed value (${min}).`);
          if (max !== undefined && value > max) throw new Error(`${label} (${value}) is more than maximum allowed value (${max}).`);
        }

        if (typeof value === 'string') {
          const minlength = limit(opts.minlength ?? opts.minLength);
          const maxlength = limit(opts.maxlength ?? opts.maxLength);
          if (minlength !== undefined && value.length < minlength) throw new Error(`${label} is shorter than the minimum allowed length (${minlength}).`);
          if (maxlength !== undefined && value.length > maxlength) throw new Error(`${label} is longer than the maximum allowed length (${maxlength}).`);
          if (opts.match instanceof RegExp && !opts.match.test(value)) throw new Error(`${label} is invalid.`);
        }
      };

      for (const path of Object.keys(schema.paths)) {
        if (path.includes('.')) continue;
        const pathObj = schema.paths[path];
        const value = this[path];

        if (pathObj.isRequired && (value === undefined || value === null)) {
          throw new Error(`${path} is required`);
        }
        if (value === undefined || value === null) continue;

        /* مصفوفة: القيود تخصّ العناصر لا المصفوفة نفسها.
           { type: [String], enum: [...] } يعني أن كل عنصر ضمن القائمة. */
        if (Array.isArray(value)) {
          const caster = pathObj.caster || pathObj.$embeddedSchemaType || pathObj;
          for (const item of value) {
            if (item === undefined || item === null) continue;
            if (typeof item === 'object') continue; // مستندات فرعية — خارج نطاق هذا الفحص
            checkOne(path, caster, item);
          }
          continue;
        }
        checkOne(path, pathObj, value);
      }
    }

    toObject(options) {
      const obj = {};
      for (const key of Object.keys(this)) {
        if (typeof this[key] !== 'function' && key !== 'isNew') {
          obj[key] = this[key];
        }
      }
      if (options && options.virtuals && schema && schema.virtuals) {
        for (const vKey of Object.keys(schema.virtuals)) {
          const virtual = schema.virtuals[vKey];
          if (virtual.getter) {
            obj[vKey] = virtual.getter.call(this);
          }
        }
      }
      return obj;
    }

    toJSON(options) {
      return this.toObject(options);
    }

    async populate(path, select) {
      if (typeof path === 'string') {
        const fields = path.split(' ');
        for (const field of fields) {
          if (this[field]) {
            let targetModelName = null;
            if (field === 'createdBy' || field === 'doctor' || field === 'recordedBy' || field === 'addedBy' || field === 'student') {
              targetModelName = 'User';
            } else if (field === 'assignment') {
              targetModelName = 'Assignment';
            } else if (field === 'subject') {
              targetModelName = 'Subject';
            } else if (field === 'batch') {
              targetModelName = 'Batch';
            }
            
            if (targetModelName && compiledModels[targetModelName]) {
              const Model = compiledModels[targetModelName];
              const store = getStore(targetModelName);
              const val = this[field];
              if (Array.isArray(val)) {
                const populatedArr = [];
                for (const id of val) {
                  const item = store.find(x => x._id.toString() === id.toString());
                  populatedArr.push(item ? new Model(item) : id);
                }
                this[field] = populatedArr;
              } else {
                const item = store.find(x => x._id.toString() === val.toString());
                if (item) {
                  this[field] = new Model(item);
                }
              }
            }
          }
        }
      } else if (typeof path === 'object' && path.path) {
        const field = path.path;
        let targetModelName = null;
        if (field === 'createdBy' || field === 'doctor' || field === 'recordedBy' || field === 'addedBy' || field === 'student') {
          targetModelName = 'User';
        } else if (field === 'assignment') {
          targetModelName = 'Assignment';
        } else if (field === 'subject') {
          targetModelName = 'Subject';
        } else if (field === 'batch') {
          targetModelName = 'Batch';
        }
        if (targetModelName && compiledModels[targetModelName] && this[field]) {
          const Model = compiledModels[targetModelName];
          const store = getStore(targetModelName);
          const val = this[field];
          if (Array.isArray(val)) {
            const populatedArr = [];
            for (const id of val) {
              const item = store.find(x => x._id.toString() === id.toString());
              populatedArr.push(item ? new Model(item) : id);
            }
            this[field] = populatedArr;
          } else {
            const item = store.find(x => x._id.toString() === val.toString());
            if (item) {
              this[field] = new Model(item);
            }
          }
        }
      }
      return this;
    }

    async save() {
      await this.validate();
      
      const modelName = name;
      const store = getStore(modelName);
      
      if (modelName === 'Notification') {
        if (this.title) this.title = this.title.trim();
        if (this.message) this.message = this.message.trim();
      }
      
      if (modelName === 'User') {
        /* isModified في هذا المحاكي يعيد true دائماً، فكان كل save (ومسار الدخول
           يحفظ المستخدم) يعيد تشفير الـhash نفسه فيفشل الدخول التالي. النموذج
           الحقيقي يتجاوز الـhash الجاهز — نطابقه هنا. */
        if (this.isModified('password') && !/^\$2[abxy]\$\d+\$/.test(String(this.password || ''))) {
          const salt = bcrypt.genSaltSync(10);
          this.password = bcrypt.hashSync(this.password, salt);
          this.passwordChangedAt = Date.now();
          if (this.isNew) {
            this.firstLogin = true;
          }
        }
      }
      
      if (!this._id) {
        this._id = new mongoose.Types.ObjectId().toString();
      }
      
      const docObj = this.toObject({ getters: true, virtuals: true });
      docObj._id = this._id;
      
      if (!docObj.createdAt) docObj.createdAt = new Date();
      docObj.updatedAt = new Date();
      
      const index = store.findIndex(item => item._id.toString() === this._id.toString());
      if (index >= 0) {
        store[index] = docObj;
      } else {
        store.push(docObj);
      }
      
      this.createdAt = docObj.createdAt;
      this.updatedAt = docObj.updatedAt;
      this.isNew = false;
      
      return this;
    }
  };

  // Copy Schema methods
  if (schema && schema.methods) {
    for (const mKey of Object.keys(schema.methods)) {
      modelClass.prototype[mKey] = schema.methods[mKey];
    }
  }

  // Copy Schema statics
  if (schema && schema.statics) {
    for (const sKey of Object.keys(schema.statics)) {
      modelClass[sKey] = schema.statics[sKey];
    }
  }

  // Copy Schema virtuals
  if (schema && schema.virtuals) {
    for (const vKey of Object.keys(schema.virtuals)) {
      const virtual = schema.virtuals[vKey];
      Object.defineProperty(modelClass.prototype, vKey, {
        get: virtual.getter,
        set: virtual.setter,
        configurable: true
      });
    }
  }

  // Set modelName property
  modelClass.modelName = name;

  // Raw driver collection shim (used e.g. by User.collection.findOne to bypass soft-delete)
  Object.defineProperty(modelClass, 'collection', {
    get() {
      const store = getStore(name);
      return {
        findOne: async (filter) => store.find(item => matchFilter(item, filter, name)) || null,
        find: (filter) => ({
          toArray: async () => store.filter(item => matchFilter(item, filter, name))
        })
      };
    },
    configurable: true
  });
  
  // Attach overrides
  modelClass.find = ModelOverrides.find;
  modelClass.findOne = ModelOverrides.findOne;
  modelClass.findById = ModelOverrides.findById;
  modelClass.create = ModelOverrides.create;
  modelClass.updateOne = ModelOverrides.updateOne;
  modelClass.updateMany = ModelOverrides.updateMany;
  modelClass.deleteOne = ModelOverrides.deleteOne;
  modelClass.deleteMany = ModelOverrides.deleteMany;
  modelClass.findByIdAndUpdate = ModelOverrides.findByIdAndUpdate;
  modelClass.findByIdAndDelete = ModelOverrides.findByIdAndDelete;
  modelClass.findOneAndDelete = ModelOverrides.findOneAndDelete;
  modelClass.findOneAndUpdate = ModelOverrides.findOneAndUpdate;
  modelClass.countDocuments = ModelOverrides.countDocuments;
  modelClass.estimatedDocumentCount = ModelOverrides.estimatedDocumentCount;
  modelClass.aggregate = ModelOverrides.aggregate;
  
  compiledModels[name] = modelClass;
  return modelClass;
};

// Mock connection
mongoose.connect = async function() { return; };
mongoose.disconnect = async function() { return; };
mongoose.connection = {
  on: () => {},
  once: (event, cb) => { if (event === 'open') cb(); },
  db: {
    admin: () => ({ ping: async () => true })
  }
};
Object.defineProperty(mongoose.connection, 'readyState', {
  get: () => 1
});

// Capture the Socket.IO HTTP server created by server.js.  The application
// uses httpServer.listen(), so patching only express.application.listen left
// the test process running forever.
const originalCreateServer = http.createServer;
let serverInstance = null;
let allocatedPort = 0;

http.createServer = function(...args) {
  const server = originalCreateServer.apply(this, args);
  const originalListen = server.listen;
  server.listen = function(port, callback) {
  const targetPort = process.env.NODE_ENV === 'test' ? 0 : port;
  const listeningServer = originalListen.call(this, targetPort, function() {
    const address = server.address();
    allocatedPort = address.port;
    if (callback) callback.call(server);
  });
  serverInstance = server;
  return listeningServer;
  };
  return server;
};

let appStarted = false;
async function startServer() {
  if (appStarted) return { port: allocatedPort, server: serverInstance };
  
  process.env.NODE_ENV = 'test';
  process.env.PORT = '0';
  process.env.JWT_SECRET = JWT_SECRET;
  
  // Clear require cache for server.js to ensure it registers our mocked express listen
  delete require.cache[require.resolve("../server.js")];
  require("../server.js");
  
  while (!allocatedPort) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  appStarted = true;
  return { port: allocatedPort, server: serverInstance };
}

async function stopServer() {
  if (serverInstance) {
    await new Promise(resolve => serverInstance.close(resolve));
    serverInstance = null;
    allocatedPort = 0;
    appStarted = false;
  }
}

// Helper to seed a user and sign token
async function seedUser(name, email, password, roles, additional = {}) {
  const User = mongoose.model("User");
  const data = {
    name,
    email: email.toLowerCase().trim(),
    password,
    roles: Array.isArray(roles) ? roles : [roles],
    isActive: true,
    firstLogin: false,
    ...additional
  };
  const user = await User.create(data);
  const token = jwt.sign(
    {
      id: user._id,
      email: user.email,
      roles: user.roles,
      name: user.name,
      firstLogin: user.firstLogin
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
  return { user, token };
}

module.exports = {
  resetDB,
  startServer,
  stopServer,
  seedUser,
  getStore,
  JWT_SECRET
};
