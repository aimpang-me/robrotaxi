'use strict';
const crypto = require('node:crypto');
const source = require('./source/nonbuilding-extrusions.json');

function isExtrudedBuilding(tags) {
  const part = tags['building:part'];
  const kind = part && part !== 'no' ? part : tags.building;
  if (!kind || kind === 'no') return false;
  // A layer is an ordering hint, not a height from which to extrude a roof.
  if (kind === 'roof' && +tags.layer > 0 && !tags.min_height && !tags['building:min_level']) return false;
  return true;
}

function removeLegacyNonBuildings(scene) {
  const excluded = new Set(source.corrections.map((c) => c.legacySha256));
  scene.buildings = scene.buildings.filter((b) => !excluded.has(crypto.createHash('sha256').update(JSON.stringify(b)).digest('hex')));
}

module.exports = { isExtrudedBuilding, removeLegacyNonBuildings };
