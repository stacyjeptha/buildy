/* The Queue object describes a plan to execute a series of tasks.
 *
 * Each queue is assigned a name so that the log can have some meaningful output, and debugging can be traced back
 * to the responsible object.
 */

var util = require('util'),
    events = require('events'),
    winston = require('winston'),
    Buildy = require('./buildy.js').Buildy;

var winstonConfig = {
    levels : {
        passes: 0,
        fails: 1,
        warning: 2,
        info: 3,
        debug: 4
    },
    colors : {
        passes: 'green',
        fails: 'red',
        warning: 'yellow',
        info: 'italic',
        debug: 'grey'
    }
};

// TODO: ability to pass logger options from CLI
var logger = new (winston.Logger)({ levels: winstonConfig.levels });
winston.addColors( winstonConfig.colors );
logger.add(winston.transports.Console, { colorize: true, level: 0 });

function Queue(name, options) {
    events.EventEmitter.call(this);

    this._name = name;
    this._queue = [];
    this._queuePosition = 0;
    this._queueStack = [];
    this._initOptions(options);
}

util.inherits(Queue, events.EventEmitter);

// Prototypical properties that were removed due to the way util.inherits behaves
// Left here for documentation reference.

//     /**
//     * Name of the task queue
//     * 
//     * @property _name
//     * @default 'queue'
//     */
//    _name : 'queue',
//    
//    /**
//     * Stack of calling queues
//     * 
//     * @property _queueStack
//     * @default undefined
//     */
//    _queueStack : undefined,
//    
//    /**
//     * Queued tasks
//     * 
//     * @property _queue
//     * @default undefined
//     */
//    _queue : undefined,
//    
//    /**
//     * Queue position
//     * 
//     * @property _queuePosition
//     * @default 0
//     */
//    _queuePosition : 0,
//    
//    /**
//     * Queue runner
//     * 
//     * @property _runner
//     * @default null
//     */
//    _runner : null,
//    
//    /**
//     * EventEmitter given to the runner which will
//     * emit complete or failed
//     * 
//     * @property _promise
//     * @default null
//     */
//    _promise : null,


/**
 * Add a task to the queue
 * 
 * @method task
 * @param type {string} a valid task type
 * @param spec {object} valid specification for that task type (see the task docs)
 * @return Queue a reference to the same Queue object.
 * @public
 */
Queue.prototype.task = function(type, spec) {
    this._queue.push({type: type, spec: spec});
    return this;
};

/**
 * Fork the current Queue into multiple Queues
 * 
 * Each function receives one parameter, the child Buildy object.
 * Each function is also executed in the context of a new Queue object. so
 * new tasks must begin with this.task('abc')
 * 
 * @method _fork
 * @param forkspec {Object} Hash of forked queue name => function
 * @protected
 */
Queue.prototype._fork = function(forkspec) {
    
    var self = this,
        runnerState = (this._runner._state instanceof Object) ? 
                this._runner._state.slice() : this._runner._state,
        runnerType = this._runner._type;
    
    Object.keys(forkspec).forEach(function eachFork(qName) {
        var q = new Queue(qName, self._options),
            childWorker = Buildy.factory(runnerType, runnerState);
        
        q._queueStack.push(this._name);
        //q._queueStack.push.apply(q._queueStack, self._queueStack);
        forkspec[qName].call(q, childWorker); // Child workers are sanctioned here
    });
};

/**
 * Run the current task queue
 * 
 * The runner keeps the input and output states for each task that is executed.
 * 
 * @method run
 * @param runner {object} An object which will accept a function signature
 * of .exec(type, spec, promise), normally this is a Buildy object
 * @public
 */
Queue.prototype.run = function(runner) {
    var t    = this._queue[this._queuePosition],
        self = this;
    
    if (t.type === 'fork') {
        this._fork(t.spec);

    } else {
    
        this._promise = new events.EventEmitter;
        this._promise.on('complete', function handleComplete() {
            self._onTaskComplete.apply(self, arguments);
        });
        this._promise.on('failed', function handleFailed() {
            self._onTaskFailed.apply(self, arguments);
        });

        this._runner = runner;

        if (t === undefined) {
            throw new Error('Task ' + t + ' is undefined');
        }

        this.emit('taskStarted', {
           queue : this._name,
           stack : this._queueStack,
           position : this._queuePosition,
           type : t.type
        });

        logger.log('debug', 'Started ' + t.type);

        this._runner.exec(t.type, t.spec, this._promise);
    }
};

/**
 * Move to the next task in the queue, or emit queueComplete if finished.
 *
 * @method next
 * @public
 */
Queue.prototype.next = function() {
    
    this._queuePosition++;

    if (this._queuePosition < this._queue.length) {
        this.run(this._runner);
    } else {
        this.emit('queueComplete', {
            queue : this._name
        });
        logger.log('info', 'Queue complete ' + this._name);
    }    
};
    
/**
 * Called after a task completes
 * 
 * Receives arguments supplied by the Buildy task
 * 
 * @method _onTaskComplete
 * @param result {Object} Task results
 * @protected
 */
Queue.prototype._onTaskComplete = function(result) {

    this.emit('taskComplete', {
        queue : this._name,
        task : this._queue[this._queuePosition], 
        result : result 
    });
    logger.passes('Completed task');
    
    this.next();
};
    
/**
 * Called after a task fails
 * 
 * Receives arguments supplied by Buildy task, at the
 * moment only an error message is passed back.
 * 
 * @method _onTaskFailed
 * @param result {String} Error message
 * @protected
 */
Queue.prototype._onTaskFailed = function(result) {
    
    this.emit('taskFailed', {
        queue : this._name,
        task : this._queue[this._queuePosition],
        result: result 
    });
    logger.log('fails', 'Failed task');
};

/**
 * Set up queue options as specified in the constructor.
 *
 * This will be used to set queue behaviour from the command line.
 * 
 * @method _initOptions
 * @param options {Object} hash of options
 * @protected
 */
Queue.prototype._initOptions = function(options) {
    var self = this;
    this._options = options;

};

exports.Queue = Queue;