/* Grants -- abilities the shell has handed to one particular item.
 *
 * Almost everything an item may do is decided by what its type declared:
 * `store:read`, `items:write`, and so on. A grant is the exception -- an
 * ability that exists because of something that just happened. When a
 * control opens the picker, the control's item could already write that
 * property, and it hands the picker the ability to write exactly that one
 * address and nothing else.
 *
 * A grant is keyed by the id of the item that received it, and it is read
 * only through a permission's API, which learns who is asking from the
 * shell rather than from anything the asker supplies. That is the whole of
 * what keeps it from being forged: there is no token to guess, because the
 * caller never names what it is asking about -- it can only ask about
 * itself.
 *
 * Deliberately not part of the plugin surface (plugins.js hands out core,
 * not this). A plugin runs in the same page and could import any module by
 * URL, so this is not a sandbox; it is the difference between the honest
 * path being the permissioned one and the documented surface handing out
 * the keys.
 */

// id of the item holding the grant -> { itemId, key, label, type, spec, api }
export const grants = new Map();
