// Inspired by osa-imessage -- https://github.com/wtfaremyinitials/osa-imessage/blob/master/index.js
const fs = require('fs')
const osa = require('osa2')
const ol = require('one-liner')
const assert = require('assert')
const macosVersion = require('macos-version')

const messagesDb = require('./lib/messages-db.js')

// seconds since 01-01-2001 00:00:00 GMT. DATE_OFFSET is the offset in seconds
// between their epoch and unix time
const DATE_OFFSET = 978307200

// Gets the current Apple-style timestamp
function appleTimeNow() {
  return Math.floor(Date.now() / 1000) - DATE_OFFSET
}

// Transforms an Apple-style timestamp to a proper unix timestamp
function fromAppleTime(ts) {
  if (ts == 0) {
    return null
  }

  // unpackTime returns 0 if the timestamp wasn't packed
  // TODO: see `packTimeConditionally`'s comment
  if (unpackTime(ts) != 0) {
    ts = unpackTime(ts)
  }

  return new Date((ts + DATE_OFFSET) * 1000)
}

// Since macOS 10.13 High Sierra, some timestamps appear to have extra data
// packed. Dividing by 10^9 seems to get an Apple-style timestamp back.
// According to a StackOverflow user, timestamps now have nanosecond precision
function unpackTime(ts) {
  return Math.floor(ts / Math.pow(10, 9))
}

// TODO: Do some kind of database-based detection rather than relying on the
// operating system version
function packTimeConditionally(ts) {
  if (macosVersion.is('>=10.13')) {
    return ts * Math.pow(10, 9)
  } else {
    return ts
  }
}

let emitter = null
let emittedMsgs = []
export default function listen() {
  // If listen has already been run, return the existing emitter
  if (emitter != null) {
    return emitter
  }

  // Create an EventEmitter
  emitter = new (require('events').EventEmitter)()

  let last = packTimeConditionally(appleTimeNow() - 5)
  let bail = false

  const dbPromise = messagesDb.open()

  async function check() {
    const db = await dbPromise
    const query = `
            SELECT
                guid,
                id as handle,
                text,
                date,
                date_read,
                is_from_me,
                cache_roomnames
            FROM message
            LEFT OUTER JOIN handle ON message.handle_id = handle.ROWID
            WHERE date >= ${last}
        `
    last = packTimeConditionally(appleTimeNow())

    try {
      const messages = await db.all(query)
      messages.forEach(msg => {
        if (emittedMsgs[msg.guid]) return
        emittedMsgs[msg.guid] = true
        emitter.emit('message', {
          guid: msg.guid,
          text: msg.text,
          handle: msg.handle,
          group: msg.cache_roomnames,
          fromMe: !!msg.is_from_me,
          date: fromAppleTime(msg.date),
          dateRead: fromAppleTime(msg.date_read),
        })
      })
      setTimeout(check, 1000)
    } catch (err) {
      bail = true
      emitter.emit('error', err)
      warn(`sqlite returned an error while polling for new messages!
                  bailing out of poll routine for safety. new messages will
                  not be detected`)
    }
  }

  if (bail) return
  check()

  return emitter
}
