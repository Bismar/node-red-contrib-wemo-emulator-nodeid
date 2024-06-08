/* eslint-disable max-lines-per-function,new-cap,consistent-this */
/**
 The MIT License (MIT)

 Copyright (c) 2016 @biddster

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
 */

module.exports = function (RED) {
    	const Wemore = require('wemore');
    	const Domain = require('domain');
    	const _ = require('lodash');
    	const Crypto = require('crypto');

    	const uuidFromSerial = function (serial) {
        	// Many thanks to https://github.com/lspiehler/node-fauxmo/blob/master/src/deviceSerial.js
        	const rawserial = Crypto.createHash('md5').update(serial).digest('hex');
        	return (
            	// eslint-disable-next-line prefer-template
            	rawserial.substring(0, 8) +
            	'-' +
            	rawserial.substring(8, 12) +
           	'-' +
            	rawserial.substring(12, 16) +
            	'-' +
            	rawserial.substring(16, 20) +
            	'-' +
            	rawserial.substring(20, 32)
        	);
    	};

    	// For each wemore.Emulate we create, wemore registers a process exit listener. By default, node
    	// only supports 10 exit listeners and we are likely to want to emulate many more devices than that.
    	// https://github.com/biddster/node-red-contrib-wemo-emulator/issues/8
    	process.setMaxListeners(0);

    	function WemoEmuDeviceNode(config){
	        RED.nodes.createNode(this, config);
	     
	        const node = this;
	        const globalConfig = { debug: false };
	
	        const getGlobalConfig = function () {
	            return _.assign(globalConfig, node.context().global.get('wemo-emulator-nodeid'));
	        };
	
	        const debug = function (args) {
	            if (getGlobalConfig().debug) {
	                node.log(...args);
	            }
	        };
	
	        // Address in use errors occur when ports clash. They stop node dead so we use a domain to notify the user.
	        // Otherwise NodeRED won't start and that's hard to debug.
	        // Note that domains are deprecated in v7. So we'll have to port to whatever replaces them in the future.
	        const d = Domain.create();
	
	        d.on('error', (e) => {
	            node.error(`Emulation error: ${e.message}`, e);
	            node.status({
	                fill: 'red',
	                shape: 'dot',
	                text: e.message,
	            });
	        });
	
	        let connection = null;
	        d.run(() => {
	            config.uuid = uuidFromSerial(config.serial);
	            debug(`UUID [${config.serial}] => [${config.uuid}]`);
	            // console.log(config.uuid);
	            // {friendlyName: "TV", port: 9001, serial: 'a unique id'}
	            connection = Wemore.Emulate(config)
	                .on('listening', function () {
			    	node.status({
					fill: 'yellow',
					shape: 'dot',
					text: `Listen on ${this.port}`,
			    	});
	                    debug(`Listening on: ${this.port}`);
	                })
	                .on('on', (_self, sender) => {
				node.warn('Host IP: ' + connection.host)
				node.warn('Calling IP: ' + sender.address.substr(7))
				
			    	if (connection.host !== sender.address.substr(7)){
					node.send({
						topic: config.onTopic,
						payload: config.onPayload,
						deviceid: node.id,
						sender,
				    	});
		                   	 node.status({
			                        fill: 'green',
			                        shape: 'dot',
			                        text: 'on',
		                    	});
		                    	debug('Turning on');
				}
	                })
	                .on('off', (_self, sender) => {
				node.warn('Host IP: ' + connection.host)
				node.warn('Calling IP: ' + sender.address.substr(7))

				if (connection.host !== sender.address.substr(7)){
		                    	node.send({
			                        topic: config.offTopic,
			                        payload: config.offPayload,
			                        deviceid: node.id,
			                        sender,
		                    	});
		                    	node.status({
			                        fill: 'green',
			                        shape: 'circle',
			                        text: 'off',
		                    	});
		                    	debug('Turning off');
				}
	                });
	        });
	
	        node.on('close', () => {
	            debug('Closing connection');
	            connection.close();
	            // debug('Closing domain');
	            // d.dispose();
	            debug('Closed');
	        });
    	}

    	RED.nodes.registerType('wemo-emulator-nodeid', WemoEmuDeviceNode, {});

	// Hub Function adopted from node-red-contrib-amazon-echo https://github.com/datech/node-red-contrib-amazon-echo/blob/master
	
	function WemoEmuHubNode(config) {
		RED.nodes.createNode(this, config);
		const hubNode = this;

		hubNode.on('input', function(msg) {
			var nodeDeviceNm = null;
			
			hubNode.status({
			    fill: 'green',
			    shape: 'ring',
			    text: 'Setup',
			});
			
			if (typeof msg.payload === 'object') {
				hubNode.warn('Device ID: ' + msg.payload.nodeid)
				hubNode.warn('Payload.On: ' + msg.payload.on)
				if ('nodeid' in msg.payload && msg.payload.nodeid !== null) {
					getDevicesNms().forEach(function(device) {
						//hubNode.warn('Devices Listing: ' + device.name)
						if (msg.payload.nodeid == device.id) {
							nodeDeviceNm = device.name
							delete msg.payload['nodeid'];
						}
					});
			    	} else {
					if ('nodename' in msg.payload && msg.payload.nodename !== null) {
						nodeDeviceNm = msg.payload.nodename
				     		delete msg.payload['nodename'];
					}
				}
			}

			hubNode.warn('Device Nane: ' + nodeDeviceNm)

			if (config.processinput > 0 && nodeDeviceNm !== null) {
				connection = Wemore.Discover(nodeDeviceNm)
					.then(function(device) {
						device.getBinaryState()
							.then(function(devState){
								hubNode.warn('Current payload: ' + devState)
							});
						
						if (msg.payload.on) {
							device.setBinaryState(1);
							device.getBinaryState().then(function(devState){
								hubNode.warn('On payload: ' + devState)
							});
							hubNode.status({
							    fill: 'green',
							    shape: 'dot',
							    text: 'on',
							});
						} else {
							device.setBinaryState(0);
							device.getBinaryState().then(function(devState){
								hubNode.warn('Off payload: ' + devState)
							});
							hubNode.status({
							    fill: 'green',
							    shape: 'circle',
							    text: 'off',
							});
						}
					})
					.fail(function(err) {
						hubNode.error('Error ' + err)
						hubNode.status({
					  		fill: 'red',
					  		shape: 'ring',
					  		text: 'Unable to find deviceID ' + deviceid
						});
					});
			}
		});
	}
	
	RED.nodes.registerType('wemo-emu-hub', WemoEmuHubNode, {});

	function formatUUID(id) {
		if (id === null || id === undefined){return '';}
		return ('' + id).replace('.', '').trim();
	}
	
	function getDevicesNms() {
		var devices = [];
		RED.nodes.eachNode(function(node) {
			if (node.type == 'wemo-emulator-nodeid') {
				devices.push({
					  id: formatUUID(node.id),
					  name: node.name
				});
			}
		});
		return devices;
	}
};
