/** Java IllegalArgumentException -> HTTP 400 {message} */
export class IllegalArgumentError extends Error {}
/** Java IllegalStateException -> HTTP 409 {message} */
export class IllegalStateError extends Error {}
