# Family Tree Site — setup guide

This is a small PHP + JSON-file powered site: a public family tree (view-only
for everyone, editable with a password) and a private family forum/blog
(only visible to people who know the password). It supports **multiple
families**, each with their own password and completely separate data —
useful if you're hosting more than one branch of relatives (or more than
one family entirely) on the same site.

## What's inside

```
index.html              the family tree page
forum.html               the forum/blog page
css/style.css              shared styling
js/tree.js                 tree logic (layout, editing, bios, photo cropping)
js/forum.js                  forum logic
js/auth-shared.js              shared sign-in widget + family switcher
api/config.php                  settings — you'll edit ONE line here
api/generate_hash.php             one-time helper to create your main password hash
api/add_family.php                 add or update additional families
api/auth.php                        login / logout / status (per family)
api/tree.php                         reads & saves a family's tree data
api/upload.php                        receives cropped photos and saves them
api/forum.php                          reads & saves a family's forum posts
api/families.php                        public list of families, for the switcher
data/tree.json                    the MAIN family's tree data (auto-created)
data/forum.json                    the MAIN family's forum data (auto-created)
data/families.json                  additional families' names + password hashes
data/tree_{slug}.json                 an additional family's tree data
data/forum_{slug}.json                 an additional family's forum data
uploads/                              uploaded photos land here (shared)
```

## 1. Upload the files to InfinityFree

1. Log into your InfinityFree account and open the **File Manager** (or use
   an FTP client like FileZilla with the credentials InfinityFree gives you).
2. Upload the **entire contents** of this folder into `htdocs/` (the web
   root). If you want the site at `yoursite.com/family/` instead of the
   root, create a `family` folder inside `htdocs/` and upload there instead
   — just remember to update `UPLOADS_URL` in `api/config.php` to match.

## 2. Make the data folders writable

PHP needs to write to two folders:

- `data/` (stores every family's tree and forum content)
- `uploads/` (stores cropped photos, shared across all families)

In the File Manager, right-click each folder → **Change Permissions** (or
"chmod") and set it to **755**. If saving/uploading still fails once the
site is live, bump it to **775** or **777**.

## 3. Set your main family's password

Every site has one built-in family, called **main** — this is your
original tree, and it's the one people see when they visit your site with
no `?family=` in the URL.

1. Visit `https://yoursite.com/api/generate_hash.php?password=yourChosenPassword`
   in your browser.
2. It prints a long string starting with something like `$2y$10$...` —
   copy the **whole thing**.
3. Edit `api/config.php` and paste it in place of `PASTE_YOUR_GENERATED_HASH_HERE`:
   ```php
   define('EDIT_PASSWORD_HASH', '$2y$10$......your hash......');
   ```
4. **Delete `api/generate_hash.php` from the server** now that you're done
   with it.
5. If your site isn't at the domain root, also update `UPLOADS_URL`.

## 3b. Optional: an admin password with extra powers

You can set a second, stronger password that unlocks a few destructive or
protective actions the everyday family password can't do:

- Locking and unlocking people (locked people can't be edited or deleted)
- Editing or deleting someone who is locked
- Deleting forum posts

**This is entirely optional, and safe to skip.** While no admin password is
set, everyone with the normal family password keeps exactly the abilities
they have today — turning this on later can never lock you out of your own
site.

To enable it:

1. Generate a hash the same way as step 3, with a *different* password.
2. Paste it into `api/config.php` on the `ADMIN_PASSWORD_HASH` line.

There's no separate admin login screen — just type the admin password into
the normal Sign in box, and the pill in the corner will read **Admin**
instead of "Editing unlocked".

For additional families, add an `adminHash` entry to that family's record
in `data/families.json` the same way.

## 4. Adding more families (optional)

If you want to host a second (or third, or tenth) family on the same site,
each with their own password and completely separate tree and forum:

1. Sign in to the **main** family tree at `yoursite.com/` (step 3 above).
2. In the same browser, visit `yoursite.com/api/add_family.php`. It's
   gated behind being signed in as main, so it's safe to leave on the
   server — nobody else can use it to create or reset a family's password
   without your main password first.
3. Fill in a **slug** (used in the URL, e.g. `smith` → letters, numbers,
   hyphens only), a **display name** (e.g. "The Smith Family"), and a
   **password** for that family. Submit.
4. That family's tree is now live at `yoursite.com/?family=smith`, and
   their forum at `yoursite.com/forum.html?family=smith`. They sign in
   with the password you just set — it has no access to any other
   family's data, and vice versa.

Running the same form again with an existing slug **resets that family's
password** (useful if someone forgets it) rather than creating a
duplicate.

A small pill in the top-right of the nav lets people switch between
families they know about, once more than one exists.

## 5. Test it

- Visit `https://yoursite.com/` — you should see an empty tree, publicly
  viewable, with a **Sign in** button.
- Click **Sign in**, enter your password, and you should see "Editing
  unlocked." Add your first person, upload a photo, and try the crop tool.
- Visit `https://yoursite.com/forum.html` — without signing in it should
  say the forum is private; after signing in you can read and post.

## How it works (good to know)

- **Viewing a family's tree is public.** Anyone with the link can see
  people, photos, and bios by clicking a card.
- **Editing is password-protected** per family, using a real server-side
  session (PHP), not just a hidden button.
- **Each family's forum is fully private** — both reading and posting
  require that family's password.
- **Uploaded photos** are cropped in the browser before uploading, and
  land in one shared `uploads/` folder (filenames are unique per-upload,
  so there's no collision risk between families).
- **The tree title** (top-left) can be clicked and edited directly once
  you're signed in — this is also what shows up as that family's name in
  the switcher.
- **Locking a person** (in their edit panel) disables the delete button
  for them, to guard against accidental deletion.

## Backups

Everything lives in `data/` and `uploads/`. Periodically download those
two folders from the File Manager as a backup — free hosting can
occasionally have hiccups, and this protects everyone's data. If you've
added extra families, their data is the `tree_{slug}.json` /
`forum_{slug}.json` files plus the shared `families.json`.

## Honest security note

Each family uses its own shared password, protected server-side with PHP
sessions and a proper bcrypt hash — real protection against a random
visitor editing a tree, not just a cosmetic lock. It is **not** bank-grade
security: anyone who has a family's password can edit that family's data,
and a determined attacker with server access could still cause trouble.
For a personal site like this, that's a reasonable trade-off. Turn on
InfinityFree's free SSL/HTTPS so passwords aren't sent in plain text.

`api/add_family.php` is gated behind your main password rather than being
a "delete after use" script like `generate_hash.php`, since you'll likely
use it more than once. That means anyone who guesses your main password
could also create or reset other families' passwords — worth knowing if
you ever share your main password loosely.

## Upgrading later

If any family's tree or forum grows large, the JSON-file storage will
still work fine (hundreds of people/posts load instantly) but could be
swapped for MySQL later without changing the front end — only the files
in `api/` would need to change to read/write a database instead of files.