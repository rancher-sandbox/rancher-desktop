'use strict';

const State = {
    STOPPED: 0,
    STARTING: 1,
    STARTED: 2,
    STOPPING: 3,
}

Object.freeze(State)

exports.State = State;