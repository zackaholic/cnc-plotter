'use strict';
const SerialPort = require('serialport');
const EventEmitter = require('events');

const Readline = SerialPort.parsers.Readline;
const port = new SerialPort('/dev/ttyS0', {
  baudRate: 115200,
});

const parser = port.pipe(new Readline('\n'));


class Emitter extends EventEmitter {};
const streamer = new Emitter();
let lowBufferThreshold = 1;

const watcher = (emitter) => {
  return (buff, threshold) => {
    if (buff.length === threshold) {
      emitter.emit('buffer-low');
    }
  }
}

const watchBuffer = watcher(streamer);

const appendNewline = (s) => `${s}\n`;

port.on('error', err => {
  console.log('Error: ', err.message);
});

port.on('open', () => {
  streamer.emit('port-open');
});

const parseGrbl = (res) => {
  console.log('Got: ', res);
  res = res.toString('utf8');
  if (res.includes('ok')) {
    grbl.use();
    fillGrblBuffer();
  }else if (res.includes('Grbl')) {
   streamer.emit('first-contact');
  }else if (res.includes('error')) {
      //switch error code?
  }
}

parser.on('data', parseGrbl);

//object methods referencing 'this' means functions composed of them must bind them
//to their parent object when passing them to the composition function

const commands = {
  queue : [],
  next : function() {
    if (this.queue.length) {
      return this.queue[this.queue.length -1];
    } else {
      return null;
    }
  },
  add: function(cmd) {
    if (cmd.charAt(cmd.length -1) !== '\n') {
      cmd += '\n';
    }
    //detect multi-line package and split into discreet lines
    //this.queue.unshift(cmd);
    const commands = cmd.split('\n')
	  .map(e => e + '\n')
	  .reverse();
    //const delineatedCommands = commands.map((e) => {
//	    return e + '\n';
 //   });
    this.queue = [...commands, ...this.queue];
    //console.log('\n Command queue: \n' + this.queue + '\n End command queue \n');
    //if streaming has stopped (or will stop after next response (a rare case??))
    //kick things off again with a newline
    //TODO: but only send once!
    if (grbl.streaming === false) {
      send('\n');
      grbl.streaming = true;
    }
  },
  consume: function() {
    const consumed = this.queue.pop();
//    console.log('Buffer size: ', this.queue.length);
//    console.log('Buffer: ' + this.queue + '\n\n');
    watchBuffer(this.queue, lowBufferThreshold);
    return consumed;
  }
}

const grbl = {
  len: 127,
  queued: [],
  free: 127,
  streaming: false,

  add: function (cmd) {
 //   console.log(`added: ${cmd} (${cmd.length})`);
    this.free -= cmd.length;
 //   console.log('grbl free: ', this.free);
    this.queued.push(cmd);
  },
  use: function () {
 //   console.log(`use called and grbl queue has ${this.queued.length} elements`);

    if (this.queued.length) {
 //     console.log(`removed: ${this.queued[0]} (${this.queued[0].length})`);
      this.free += this.queued.shift().length;
 //     console.log('free: ', this.free);
      if (this.free === this.len) {
        //last command in queue has been parsed!
        streamer.emit('grbl-empty');
        this.streaming = false;
      }
    }
  }
}
const viewBytes = (s) => {
  return s.slice().split('').map((e) => {return e.charCodeAt(0)});
}

const send = (cmd) => {
  console.log(`sending: ${cmd}`);
  port.write(cmd);
}

const consumer = (getCmd, send, track) => {
  return () => {
    let command = getCmd();
    track(command);
    send(command);
  }
}

const consumeCommand = consumer(commands.consume.bind(commands), send, grbl.add.bind(grbl));

const fillGrblBuffer = () => {
  if (commands.next() && (commands.next().length < grbl.free)) {
    consumeCommand();
    fillGrblBuffer();
  } else {
    return;
  }
}

module.exports = streamer;
streamer.buffer = (cmd) => {
  commands.add(cmd);
}
streamer.setThreshold = (thresh) => {
  lowBufferThreshold = thresh
};
