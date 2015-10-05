/* @flow */
type curry3<A,B,C,D> = (func:(a:A,b:B,c:C) => D) => (((a:A) => (b:B) => (c:C) => D) | ((a:A) => (b:B,c:C) => D) | (a:A,b:B,c:C) => D);
type curry2<A,B,C> = (func:(a:A,b:B) => C) => (((a:A) => (b:B) => C) | (a:A,b:B) => C);
type Signal<A> =
{
  value:(A | Symbol);
  getNext: () => Promise<any>;
};

export const NEW_SIGNAL = Symbol ('NEW_SIGNAL');
export const NONE = Symbol ('NONE');
export const STOP = Symbol ('STOP');
export const NO_VALUES: Array<Symbol> = [NEW_SIGNAL, NONE, STOP];
function CreateResolvedPromise<A>(a:A):Promise<A> {
  return new Promise((resolve) => resolve(a));
}
const noop: Function = ()=>null;
const curry_2: curry2 = (fn) => (a,b) =>
  arguments.length >= 2 ? fn(a,b) :
    (b) => fn(a,b);
const curry_3: curry3 = (fn) => (a,b,c) =>
  arguments.length >= 3 ? fn(a,b,c) :
    arguments.length >= 2 ? (c) => fn(a,b,c) :
    (b,c) => arguments.length >= 2 ? fn (a,b,c) :
      (c) => fn(a,b,c);
/**
 * Signal is a value over time, this is just a link to next moment in time. And is lazy
 * a -> (() -> Promise Signal a) -> Signal a
 * @param  {Any} @value   [description]
 * @param  {Function} @getNext [description]
 * @return {Signal}          [description]
*/
function SignalFactory<A>(value: A, getNext: () => Promise<Signal<A>>):Signal<A>{
  return {
    value,
    getNext
  };
}

const SIGNAL_DEAD: Signal = SignalFactory (STOP, noop);
function CurrentSignal<A>(tailSignal: Signal<A>):Signal<A> {
  const me = {};
  me.tailSignal = tailSignal;
  me.value = NEW_SIGNAL;
  update(tailSignal);
  me.getNext = () => CreateResolvedPromise (me.tailSignal);
  return me;


  function update (signal) {
    if(signal.value === STOP || !signal.getNext){
      return;
    }
    me.tailSignal = signal;
    const next = signal.getNext();
    if (next){
      next.then ((nextSignal) => update (nextSignal));
    }
  }
}




/**
 * Create a signal form an array
 * [a...] -> Signal a
 * @param  {Array a} array [a...] | Value of a
 * @return {Signal a}       Signal a
*/
export const fromArray = function<A> (array : Array<A>): Signal<A> {
  return [NEW_SIGNAL].concat(array)
  .reverse()
  .reduce (function (head, arrayValue) {
    const resolveWithHead = function(resolve) {
      resolve(head)
    };
    const newPromise = new Promise(resolveWithHead);
    return SignalFactory (arrayValue, () => newPromise);
  }, SIGNAL_DEAD);
};

/**
 * create a signal from a function that can 'sink' values in
 * Note that this could be a memory leak
 * ((a -> ()) -> ()) -> Signal a
 * @param  {Function} sinkNewValue (a -> ()) -> () | A function to drop a new value
 * @return {Signal}              Signal a
*/
export const fastForwardFunction = function <A>(sinkNewValue: (sink:(a:A) => any) => any) : Signal<A>{
  const initValue = NEW_SIGNAL;
  let currentResolve:Function = noop;
  const newTail = function (value) {
    const newPromise = new Promise (function(resolve: (newSignal:Signal)=> void) {
      currentResolve = resolve;
    });
    return SignalFactory (value, () => newPromise);
  };

  const answer = newTail (initValue);
  sinkNewValue ((newValue) => currentResolve (newTail (newValue)));
  return answer;
};

/**
 * create a signal from a function that can 'sink' values in
 * Note that this could be a memory leak
 * ((a -> ()) -> ()) -> CurrentSignal a
 * @param  {Function} sinkNewValue (a -> ()) -> () | A function to drop a new value
 * @return {Signal}              CurrentSignal a | A current signal of a
*/
export const fromFunction = function <A>(sinkNewValue: (sink:(a:A)=>any) => any) : Signal<A>{
  return CurrentSignal(fastForwardFunction(sinkNewValue));
};




/**
 * From Promises
 * Promise a -> ... -> Signal a
 * @param  {Promise} promises... [description]
 * @return {Signal}             [description]
*/
export const fromPromises = function<A>(...promises : Array<Promise<A>>): Signal<A> {
  let sink;
  const assignSink = (newSink) => sink = newSink;
  const answer: Signal<A> = fromFunction(assignSink);
  promises.forEach((promise: Promise) => promise.then(sink));
  return answer;
};

/**
 * Determines is value is a signal
 * a -> Booelan
 * @param  {[type]} predicateValue [description]
 * @return {[type]}                [description]
*/
export function isSignal (predicateValue: Signal | any): boolean {
  const hasValue = predicateValue && predicateValue.hasOwnProperty('value');
  const hasGetNext = predicateValue ? typeof predicateValue.getNext === 'function' : false;
  return hasValue && hasGetNext;
}

/**
 * This is a each loop that is expecting side effeces
 * Notes that this returns a garbage collection, that combined with a fromFunction, it will hold memory all the way to the source
 * (a -> ()) -> Signal a -> (() -> ())
 * @param  {Function} onValue        a -> () | Where we call on signal
 * @param  {[type]} startingSignal    Signal a
 * @return {Function}                () -> () | Clean up
*/
export const onValue = curry_2(function(onValue, startingSignal) {
  let withNext = function (signal) {
    const values = [].concat(signal.value);
    const isValue =  values.every(function(value){
      return NONE !== value && NEW_SIGNAL !== value;
    });
    if (signal.value == STOP){
      return;
    }
    if (isValue){
      onValue (signal.value);
    }
    signal.getNext().then (withNext);
  };
  withNext(startingSignal);
  return function () {
    onValue = noop;
    withNext = noop;
  };
});

/**
 * [Fold](https://en.wikipedia.org/wiki/Fold_(higher-order_function)) but with a signal, which is potential future
 * (a -> b) -> a -> signal a -> signal b
 * @param  {Function} foldFunction (state -> a -> state) Reduce function
 * @param  {a} initialState a
 * @param  {Signal} signal       Signal a
 * @return {Sginal}              Signal state
*/
export const foldp = curry_3(function <A,B>(foldFunction: (b:B,a:A)=>B , initialState: B, signal: Signal<A>): Signal<B>{
  //TODO
  const untilNext = function (nextSignal){
    const isSkipValue = nextSignal.value === NEW_SIGNAL || nextSignal.value === NONE;
    const isStop = nextSignal.value === STOP;
    if (isStop){
      return nextSignal;
    }
    if (isSkipValue) {
      return nextSignal.getNext().then(untilNext);
    }
    const nextValue = foldFunction (initialState, nextSignal.value);
    const shouldSkip = nextValue === NONE;
    const shouldStop = nextValue === STOP;
    return shouldSkip ?
      nextSignal.getNext().then(untilNext) :
      shouldStop ?
      SIGNAL_DEAD :
      foldp (foldFunction, nextValue, nextSignal);
  };
  return SignalFactory (initialState, () => signal.getNext().then(untilNext));
});

/**
 * Map a function across the signal
 * (a -> b) -> Signal a -> Signal b
 * @param  {Function} mapFunction (a -> b) | map domain to codomain
 * @param  {Signal} signal      Signal a | Signal of domain
 * @return {Signal}             Signal b | Signal of codomain
*/
export const map = curry_2(function<A,B>(mapFunction:(a:A)=>B, signal:Signal<A>):Signal<B> {
  return foldp ((memo, newValue) => mapFunction (newValue))(NEW_SIGNAL)(signal);
});


/**
 * Flatten a signal of signals into a single signal
 * Signal (Signal a | a) -> Signal a
 * @param  {[type]} signal [description]
 * @return {[type]}        [description]
*/

export function flatten<A> (signal: Signal<(Signal<A> | A)>):Signal<A>{
  const withNext = (nextSignal) =>
    flatten ( isSignal (nextSignal.value) ?
              join (nextSignal.value, nextSignal) :
              nextSignal);

  const isEnd = !signal || signal.value == STOP;
  return isEnd ?
    signal :
    SignalFactory (signal.value, () =>
      signal.getNext().then(withNext));
}

/**
 * Join two signals into one, dies when both die.
 * Signal a -> Signal b -> Signal (a | b)
 * @param  {Signal} signalA [description]
 * @param  {Signal} signalB [description]
 * @return {Signal}         [description]
 */
export function join <A>(signalA:Signal<A>, signalB:Signal<A>): Signal<A>{
  if (!signalA || signalA.value == STOP){
    return signalB;
  }
  const nextSignal: (left: Promise<Signal<A>>,right:Promise<Signal<A>>) => Promise<Signal<A>> = function (promiseLeft, promiseRight):Promise {
    const getNextSignal = (otherPromise) => (newSignal) =>
      !newSignal || newSignal.value === STOP ?
        otherPromise :
        SignalFactory (newSignal.value, () =>
          nextSignal (newSignal.getNext(), otherPromise));
    const signalOrEnd:(a:any) => Signal = (potentialSignal) =>
      isSignal(potentialSignal) ? potentialSignal : SIGNAL_DEAD;

    const race = function(promises):Promise {
      return new Promise(function(resolve){
        promises.forEach((promise) => promise.then((potentialValue)=>resolve(potentialValue)))
      });
    };
    return race([
      promiseLeft.then (getNextSignal (promiseRight)),
      promiseRight.then (getNextSignal (promiseLeft))
    ]);
  };
  return SignalFactory (signalA.value, () =>
    nextSignal (signalA.getNext(), signalB.getNext()));
}

/**
 * Filter a signal over time
 * (a -> boolean) -> Signal a -> Signal a
 * @param  {Function} filterFunction Truth means to bring it forward
 * @param  {Signal} signal         Source
 * @return {Signal}                Filtered source
*/
export var filter = curry_2(function<A,B>(filterFunction:(a:A)=>boolean, signal:Signal<A>):Signal<A> {
  return foldp ((memo, newValue) => (!filterFunction (newValue) ? NONE : newValue), NEW_SIGNAL, signal);
});

/**
 * { k` = Signal a`, k`` = Signal a``, ..., k^n = a^n} -> Signal { k` = a`, k`` = a``, ..., k^n = a^n}
 * @param  {[type]} objectToMerge [description]
 * @return {[type]}               [description]
*/
export function mergeObject <A>(objectToMerge: {[key:string]:Signal<A>}):Signal<A> {
  const keyPairToArraySignals = (signal:Signal, key:string) =>
    map (function (a) {
      let answer = {};
      answer[key] = a;
      return answer;
    })(signal)
  const setOfSignals: Array<Signal> = (Object.keys(objectToMerge) || [])
  .map((key)=>
    keyPairToArraySignals(objectToMerge[key],key));
  const joinedSignal = (setOfSignals.slice(1)).reduce((joinedSignal,additionalSignal) =>
    join(joinedSignal, additionalSignal),
    setOfSignals[0]);
  const backToObject = foldp ((lastAnswer,value) =>
      Object.assign({},lastAnswer, value),
    {});

  const filterEmpty = filter ((a) => Object.keys(a).length);

  return filterEmpty (backToObject (joinedSignal));
}


export const getLatest = (signalA:Signal):Signal => CurrentSignal (signalA) ;

/**
 * These are functions that will return a signal that follows the tails, ensuring that the latest is always there.
*/
const mergeObjectLatest = function<A>(a:{[key:string]:Signal<A>}):Signal<A>{
  return getLatest(mergeObject(a));
};
export const latest ={
  mergeObject:  mergeObjectLatest,
};
