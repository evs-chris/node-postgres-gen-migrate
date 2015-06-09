# postgres-gen-migrate

postgres-gen-migrate is a simple migration manager for PostgreSQL that uses the postgres-gen library to run migrations. Its goal is to be flexible and mostly stay out of the way while taking advantage of PostgreSQL's handy transactional DDL.

## Migrations

Migrations come in two (and a half) flavors: sql and js, with the half-flavor being es6 transpiled via the ever excellent [babel](http://babeljs.io/). The es6-flavored script migrations benefit greatly from string template support. If your node flavor happens to also support string templates, then you may not want to use the babel-ified version. There are other benefits to babel too, but they tend to be much less pronounced in migration scripts.

Migratons should be named as a 14-digit timestamp in the form `YYYYMMddHHMMSS` followed by an `_`, a name, and an appropriate extension. There is a CLI helper to generate new migrations that will handle naming and setting up the initial content of a migration file for you. By default, migrations are created in the CWD in a `migrations` folder.

### SQL

SQL migrations are simply SQL files that have an optional `-- down` section. When a SQL migration is loaded, it is split into lines and any comments and whitespace-only lines are removed. If a `-- down` comment line is encountered, any lines following it are used for the down portion of the migration. If a SQL mgration has no down section, it will automatically complete successfully if rolled back.

SQL migratins require a `.sql` extension to be identified as such.

### Script

Script migrations are loaded as a function body in the context of a migration object with the current configuration (as `config`) as a parameter. The function is expected to create an `up` and, optionally, a `down` generator and assign them to the context (`this`). Each migration method receives a transaction from [postgres-gen](https://github.com/evs-chris/node-postgres-gen), which gives them access to all of the handy helpers it provides. It is very important to yield each interaction with the database so that the transaction can commit or fail correctly.

Script migrations are the default. You can leave off the extension, use `.es6` to use babel transpilation, or use `.js` (or really anything else) for plain scripts.

## CLI

postgres-gen-migrate comes with a helper bin called `pgmigrate` to create and run migrations. It has three commands, each with a few options. Each command provides a `--help` flag if you need a reference. All of the commands can be passed an option config `-c` flag that sepciies which named configuration to use with the command.

### `new`

The `new` command creates a new migration file. You can provide a name and optional type with the flags `-n` and `-t`. The name is required, and if you don't provide one as a flag, you will be asked to provide one over stdin.

### `up [target]`

The `up` command runs forward through migrations to the given target. If no target is given, all available migrations will be run. If the target is an integer `n`, `n` migrations forward will be run. If the target is a 14-digit timestamp, then the migrations will be run to nearest migration on or before the timestamp.

### `down target`

The `down` command runs backward through migrations including the given target, where the target is required. If the target is an integer `n`, then `n` migrations will be backed down. If the target is a 14-digit timestamp, then the migrations will be run backward to the nearest migration on or before the timestamp.

## Configuration

postgres-gen-migrate uses [flapjacks](https://github.com/evs-chris/node-flapjacks) for configuration. It expects at least a `migration.connection` key to be provided with either a connection string or a connection object. All keys provided should belong to the `migration` parent.

* `es6` - if `true` enable babel by default
* `path` - the folder in which to plae and from which to read migration files (defaults to `./migrations`)
* `connection` - the connection string or object for the target database
* `table` - the name of the version tracking table (defaults to `_db_version`)
* `log` - and object with at least `error`, `warn`, and `info` methods used to log messages (defalts to using `console.log` equivalents)
* `configurations` - a map of named configurations

### Configurations

Multiple named configurations can be provided in the configurations key. Each configuration can specify all of the settings above except `configurations`. This is useful for aggregated micro-service code bases that may manage multiple semi-related databases.

## Building

postgres-gen-migrate uses [gobble](https://github.com/gobblejs/gobble) for building. The source is in `src` and gets transpiled to the `build` folder. To get started, just run `npm run-script build`.

## TODO

* Test suite!

## License

MIT
