#!/usr/bin/env node
var sander = require('sander');
var flapjacks = require('flapjacks');
var path = require('path');
var migrate = require('./index');

var opts = {
  config: { short: 'c', alias: 'config', type: 'string', describe: 'when there are multiple named configurations, this should be the name of the one to use' },
  target: { short: 't', alias: 'target', type: 'string', describe: `specifies which migration to target:
  blank - specifies the latest migration
  positive number - forward n migrations
  negative number - backward n migrations
  date - the closest migration on or before date` },
  type: { short: 't', alias: 'type', type: 'string', default: 'script', describe: 'type of migration to create - script or sql' },
  name: { short: 'n', alias: 'name', type: 'string', describe: 'the name of the migration' }
};

var args = require('yargs').
  usage('Usage: $0 <command> [options]').
  command('new', 'Create a new migration', yargs => {
    yargs.
    option(opts.type.short, opts.type).
    option(opts.name.short, opts.name).
    option(opts.config.short, opts.config).
    help('help');
  }).
  command('up', 'Migrate forward', yargs => {
    yargs.
    option(opts.config.short, opts.config).
    option(opts.target.short, opts.target).
    help('help');
  }).
  command('down', 'Migrate backward', yargs => {
    yargs.
    option(opts.config.short, opts.config).
    option(opts.target.short, opts.target).
    help('help');
  }).
  demand(1).
  help('help').
  argv;

function done() {
  process.exit(0);
}

var config = require('flapjacks').read();
if (args.config) {
  let cfg = config.get(`migration.configuration.${args.config}`);
  if (!cfg) {
    console.error(`The given configuration (${args.config}) does not exist.
Please create it in your configuration file at 'migration.configuration.${args.config}'.`);
    process.exit(1);
  }
  config = cfg;
} else {
  config = config.get('migration');
}
config.path = config.path || './migrations';


if (args._[0] === 'new') {
  let tpl, type = args.type === 'sql' ? 'sql' : 'js';
  if (type === 'sql') {
    tpl = `-- up
-- your migration statements go here

-- down
-- if you want a reversible migration, the down statements go here
-- you can safely remove this line and the two above it
`;
  } else {
    tpl = `// always remember to YIELD!
this.up = function*(trans) {
  // forward migration stuff goes here
  // e.q.
  // yield trans.nonQuery('create table foo (id bigserial primary key, bar varchar, baz integer);');
};

// this function is optional
this.down = function*(trans) {
  // backward migration stuff goes here
}
`;
  }

  let dt = new Date().toISOString().replace(/[^\d]/g, '').substr(0, 14), next;
  if (args.name) next = Promise.resolve(`${dt}_${args.name}.${type}`);
  else {
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdout.write('Migration Name: ');
    next = new Promise(function(ok, fail) {
      let agg = '';
      process.stdin.on('data', function(text) {
        agg += text;
        if (agg.indexOf('\n') !== -1) {
          ok(`${dt}_${agg.substring(0, agg.indexOf('\n'))}.${type}`);
        }
      });
    });
  }

  next.then(name => {
    return sander.writeFile(path.join(config.path, name), tpl);
  }).then(done, err => { console.error(err); process.exit(1); });
} else if (args._[0] === 'up' || args._[0] === 'down') {
  let target = args.target || args._[1] || null;
  if (target) {
    if (/^[0-9]{1,3}$/.test(target)) {
      target = +target * (args._[0] === 'down' ? -1 : 1);
    }
  }
  migrate = migrate(config);
  migrate(target).then(done, err => { console.error(err); process.exit(1); });
}
