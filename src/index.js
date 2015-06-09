var sander = require('sander');
var path = require('path');
var log = (function() {
  try {
    return require('blue-ox')('migration');
  } catch (e) {
    return { error() { console.error.apply(console, arguments) }, warn() { console.warn.apply(console, arguments); }, info() { console.info.apply(console, arguments); } };
  }
})();
var dateRE = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_(.+)/;
var justDateRE = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/;
var babel = null, pggen;

module.exports = function(config) {
  if (!config.log) config.log = log;
  if (typeof config.log.error !== 'function' || typeof config.log.warn !== 'function' || typeof config.log.info !== 'function') {
    console.error('Please supply a logger with error, warn, and info methods.');
    throw new Error('Invalid logger');
  }

  if (!config.table) config.table = '_db_version';

  if (babel === null) {
    try {
      babel = require('babel-core');
    } catch (e) {
      babel = false;
      if (config.es6) config.log.warn('You requested ES6 in your config, but there is no babel module available. ES6 is disabled.');
      config.es6 = false;
    }
  }

  if (!config.connection) {
    config.log.error('You must supply a connection config.');
    throw new Error('No connection config specified.');
  }

  try {
    pggen = require('postgres-gen');
  } catch (e) {
    config.log.error('postgres-gen-migrate requires postgres-gen to be installed as a peer.');
    throw e;
  }

  // null = migrate to end
  // Date or string = migrate to target
  // positive num = migrate forward by num
  // negative num = migrate backward by num
  function migrate(target = null) {
    let con = pggen(config.connection);
    return checkDb(con, config.table).then(v => {
      return getMigrations(config.path).then(ms => {
        // find current index (may be -1)
        let mig, i;
        for (i = 0; i < ms.length; i++) {
          if (ms[i].date.getTime() === v.getTime()) {
            mig = ms[i]; break;
          }
        }
        if (!mig) {
          i = -1;
          mig = { date: new Date('0001-01-01T00:00:00') };
        }
        let m, start = 0, end = ms.length - 1;

        if (typeof target === 'number' && target.toString().length > 4) target = `${target}`;

        // see what the target is
        if (target && (typeof target.getTime === 'function' || typeof target === 'string')) {
          if (typeof target === 'string' && (m = justDateRE.exec(target))) target = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
          if (typeof target === 'string') {
            try { target = new Date(target); } catch (e) { config.log.error(`'${target}' is not a valid target.`); throw e; }
          }
          if (target.getTime() === mig.date.getTime()) {
            start = end = i;
          } else if (target.getTime() < mig.date.getTime()) {
            // going backward
            start = i;
            end = migrationBefore(target, ms);
          } else {
            // going forward
            start = i;
            end = migrationBefore(target, ms);
          }
        } else if (typeof target === 'number') {
          start = i;
          end = start + target;
        } else { // null, so migrate from here to end
          start = i;
          end = ms.length - 1;
        }

        let list = [];
        if (start < end) {
          if (start < 0) start = 0;
          if (end >= ms.length) end = ms.length - 1;

          if (i > -1) start++; // don't try to rerun the current migration
          for (i = start; i <= end; i++) list.push(ms[i]);
        } else {
          if (end < -1) end = -1;
          if (start >= ms.length) start = ms.length - 1;

          if (i < 0) i = end; // nothing to roll back
          for (i = start; i > end; i--) list.push(ms[i]);
        }

        if (list.length === 0) {
          config.log.info('No eligible migrations found.');
          return Promise.resolve(true);
        } else {
          config.log.info(`Found ${list.length} eligible migrations.`);
        }

        // run 'em
        return applyList(con, list, config, end < start);
      });
    });
  }

  return migrate;
}

function migrationBefore(date, list) {
  for (var i = 0; i < list.length; i++) {
    if (list[i].date.getTime() > date.getTime()) {
      break;
    }
  }
  return i - 1;
}

function checkDb(con, tbl) {
  return con.query(`select version from ${tbl};`).then(v => {
    if (v.rows.length === 0) {
      return con.nonQuery(`insert into ${tbl} (version) values ('0001-01-01');`).then(() => new Date('0001-01-01'));
    } else if (v.rows.length > 1) {
      throw new Error(`Something is wrong with the version tracking table. "There can be only one (row)."`);
    } else {
      return new Date(v.rows[0].version);
    }
  }, err => {
    if (err.message.indexOf('exist') !== -1) {
      return con.nonQuery(`create table ${tbl} (version varchar not null); insert into ${tbl} values ('0001-01-01');`).then(() => {
        return new Date('0001-01-01');
      });
    }
    throw err;
  });
}

var noExt = /\.[a-zA-Z]*$/;
function getMigrations(dir) {
  return sander.lsr(dir).then(files => files.filter(f => dateRE.test(path.basename(f)))).then(files => {
    files.sort();
    let last = new Date('0001-01-01');
    return files.map(f => {
      let m = dateRE.exec(f), prev = last;
      last = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
      return { path: path.join(dir, f), date: last, name: m[7].replace(noExt, ''), previous: prev, fullName: m[0] };
    });
  });
}

function applyList(con, list, config, back = false) {
  list = list.slice(0);

  function next() {
    if (list.length > 0) {
      let m = list.shift();
      return apply(con, m, config, back).then(next);
    } else return Promise.resolve(true);
  }

  return next();
}

var downRE = /^\s*--\s*down\s*$/i;
var commentRE = /^\s*--.*$|^\s*$/;
function apply(con, migration, config, back = false) {
  return sander.readFile(migration.path).then(f => {
    f = f.toString('utf8');
    let ext = path.extname(migration.path);

    if (ext === '.sql') {
      let lines = f.split(/\r?\n/), up = [], down = [], dest = up;
      for (let i = 0; i < lines.length; i++) {
        if (downRE.test(lines[i])) {
          dest = down;
        } else if (commentRE.test(lines[i])) {
        } else {
          dest.push(lines[i]);
        }
      }

      migration.up = makeSqlFn(up.join('\n'));
      if (down.length > 0) {
        migration.down = makeSqlFn(down.join('\n'));
      } else {
        migration.down = true; // empty migration down is automagically ok
      }
    } else if (babel && (ext === '.es6' || config.es6 === true)) {
      let fn = new Function('config', babel.transform(f, { blacklist: ['regenerator'] }));
      fn.call(migration, config);
    } else {
      let fn = new Function('config', f);
      fn.call(migration, config);
    }

    if (back) {
      if (isGenerator(migration.down)) {
        return con.transaction(function*(trans) {
          config.log.info(`Rolling ${migration.name} back...`);
          yield* migration.down(trans);
          yield trans.nonQuery(`update ${config.table} set version = ?`, migration.previous.toISOString().substr(0, 19));
        });
      } else if (migration.down === true) {
        return Promise.resolve(true);
      } else throw new Error(`Can't migrate ${migration.name} (${migration.fullName}) down, as it doesn't have a valid down handler.`);
    } else {
      if (isGenerator(migration.up)) {
        return con.transaction(function*(trans) {
          config.log.info(`Running ${migration.name}...`);
          yield* migration.up(trans);
          yield trans.nonQuery(`update ${config.table} set version = ?`, migration.date.toISOString().substr(0, 19));
        });
      } else throw new Error(`Can't migrate ${migration.name} (${migration.fullName}), as it doesn't have a valid up handler.`);
    }
  });
}

function makeSqlFn(sql) {
  return function*(trans) {
    return yield trans.nonQuery(sql);
  }
}

var generatorConstructor = (function* () { yield 1; }).constructor;
function isGenerator(fn) { return fn && typeof fn === 'function' && fn instanceof generatorConstructor; }
