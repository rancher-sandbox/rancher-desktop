// @TODO replace this with popper.js...

export const LEFT = 'left';
export const RIGHT = 'right';
export const TOP = 'top';
export const CENTER = 'center'; // These are both the same externally so you can use either,
export const MIDDLE = 'center'; // but have different meaning inside this file (center->left/right, middle->top/bottom)
export const BOTTOM = 'bottom';
export const AUTO = 'auto';

export function boundingRect(elem) {
  const pos = elem.getBoundingClientRect();
  const width = elem.offsetWidth;
  const height = elem.offsetHeight;

  return {
    top:    pos.top,
    right:  pos.left + width,
    bottom: pos.top + height,
    left:   pos.left,
    width,
    height,
  };
}

export function fakeRectFor(event) {
  return {
    top:    event.clientY,
    left:   event.clientX,
    bottom: event.clientY,
    right:  event.clientX,
    width:  0,
    height: 0,
  };
}

export function screenRect() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const top = window.pageYOffset;
  const left = window.pageXOffset;

  return {
    top,
    right:  left + width,
    bottom: top + height,
    left,
    width,
    height,
  };
}

export function fitOnScreen(contentElem, triggerElemOrEvent, opt, useDefaults) {
  let {
    positionX = AUTO, // Preferred horizontal position
    positionY = AUTO, // Preferred vertical position
  } = opt || {};

  const {
    fudgeX = 0,
    fudgeY = 0,
    overlapX = true, // Position on "top" of the trigger horizontally
    overlapY = false, // Position on "top" of the trigger vertically
  } = opt || {};

  const screen = screenRect();
  let trigger;

  if ( triggerElemOrEvent instanceof Event ) {
    trigger = fakeRectFor(triggerElemOrEvent);
  } else {
    trigger = boundingRect(triggerElemOrEvent);
  }

  let content = {};

  if (contentElem) {
    content = boundingRect(contentElem);
  }

  if (useDefaults) {
    content = {
      top:    0,
      right:  147,
      bottom: 163,
      left:   0,
      width:  147,
      height: 80
    };
  }

  // console.log('screen', screen);
  // console.log('trigger', trigger);
  // console.log('content', content);

  const style = { position: 'absolute' };

  const originFor = {
    left:   (overlapX ? trigger.left : trigger.right ),
    center: (trigger.left + trigger.right ) / 2,
    right:  (overlapX ? trigger.right : trigger.left ),
    top:    (overlapY ? trigger.bottom : trigger.top ),
    middle: (trigger.top + trigger.bottom ) / 2,
    bottom: (overlapY ? trigger.top : trigger.bottom ),
  };

  // console.log('origin', originFor);

  const gapIf = {
    left:   screen.right - content.width - originFor.left,
    center: Math.min(screen.right - (content.width / 2) - originFor.center, originFor.center - (content.width / 2) - screen.left),
    right:  originFor.right - content.width - screen.left,
    top:    originFor.bottom - content.height - screen.top,
    middle: Math.min(originFor.middle - (content.height / 2) - screen.top, screen.bottom - (content.height / 2) - originFor.middle),
    bottom: screen.bottom - content.height - originFor.top,
  };

  // console.log('gapIf', gapIf);

  if ( positionX === CENTER && gapIf.center < 0) {
    positionX = AUTO;
  }

  if ( positionX === AUTO ) {
    positionX = gapIf.left < 0 || gapIf.right * 1.5 > gapIf.left ? RIGHT : LEFT;
  } else if ( positionY === LEFT && gapIf.left < 0 ) {
    positionX = RIGHT;
  } else if ( positionY === RIGHT && gapIf.right < 0 ) {
    positionX = LEFT;
  }

  switch ( positionX ) {
  case LEFT:
    style.left = `${ originFor.left - fudgeX }px`;
    break;
  case CENTER:
    style.left = `${ ((originFor.left + originFor.right) / 2) - (content.width / 2) - fudgeX }px`;
    break;
  case RIGHT:
    style.left = `${ originFor.right + fudgeX - content.width }px`;
    // style.right = `${ screen.width - originFor.right - fudgeX }px`;
    break;
  }

  if ( positionY === MIDDLE && gapIf.middle < 0) {
    positionY = AUTO;
  }

  if ( positionY === AUTO ) {
    positionY = gapIf.top < 0 || gapIf.bottom * 1.5 > gapIf.top ? BOTTOM : TOP;
  } else if ( positionY === TOP && gapIf.top < 0 ) {
    positionY = BOTTOM;
  } else if ( positionY === BOTTOM && gapIf.bottom < 0 ) {
    positionY = TOP;
  }

  switch ( positionY ) {
  case TOP:
    style.top = `${ originFor.top + fudgeY - content.height }px`;
    break;
  case CENTER:
    style.top = `${ ((originFor.top + originFor.bottom) / 2) + fudgeY - content.height }px`;
    break;
  case BOTTOM:
    style.top = `${ originFor.bottom - fudgeY }px`;
    break;
  }

  // console.log(positionX, positionY, style);

  return style;
}
