var gobble = require('gobble');

var result;

result = gobble('src').transform('babel', { blacklist: ['regenerator'] });

module.exports = result;
