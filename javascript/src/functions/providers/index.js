'use strict';

const infobip = require('./infobip');
const soprano = require('./soprano');
const telesign = require('./telesign');
const webexconnect = require('./webexconnect');

function selectProvider(name) {
    switch (String(name || '').trim().toLowerCase()) {
        case 'infobip': return infobip;
        case 'soprano': return soprano;
        case 'telesign': return telesign;
        case 'webexconnect': return webexconnect;
        default: return null;
    }
}

module.exports = { selectProvider, infobip, soprano, telesign, webexconnect };
