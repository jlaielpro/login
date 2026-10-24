<<<<<<< HEAD
# BD — sign up, login & admin

A small, dependency-free login website with a real database behind it.

- `signup.html` — create an account
- `login.html` — sign in (shows a signed-in state for regular users)
- `admin.html` — admin-only list of everyone who signed up, with search and delete
- `data/app.db` — SQLite database containing the accounts and sessions

## Run it

You need Node.js 22.5 or newer (it uses the built-in `node:sqlite` module).
Nothing needs to be installed.

```powershell
cd bd
node server.js
```

Then open <http://127.0.0.1:3000>.

## Admin account

The first time the server starts it creates an admin account and prints the
details in the terminal:

```
email:    admin@bd.local
password: Admin123!
```

Sign in with those credentials and you land on the admin dashboard. Change the
credentials before the first run:

```powershell
$env:ADMIN_EMAIL = "you@example.com"
$env:ADMIN_PASSWORD = "a-strong-password"
node server.js
```

The admin account is only seeded when no account with that email exists. To
create a brand new database, stop the server and delete the `data` folder.

## Seeing the data

The admin page reads straight from the database (`GET /api/admin/users`).
You can also open `data/app.db` with any SQLite viewer, for example
[DB Browser for SQLite](https://sqlitebrowser.org/), or query it from the
terminal:

```powershell
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('data/app.db');console.table(db.prepare('SELECT id,name,email,role,created_at,last_login_at FROM users').all())"
```

Password hashes are stored with scrypt and are never sent to the browser.

## Configuration

| Variable         | Default          | Purpose                       |
| ---------------- | ---------------- | ----------------------------- |
| `PORT`           | `3000`           | Port to listen on             |
| `HOST`           | `127.0.0.1`      | Interface to bind             |
| `ADMIN_EMAIL`    | `admin@bd.local` | Seed admin email              |
| `ADMIN_PASSWORD` | `Admin123!`      | Seed admin password           |
| `ADMIN_NAME`     | `Administrator`  | Seed admin display name       |

Example on another port: `$env:PORT = "4000"; node server.js`

To let other devices on your network reach the site, set `$env:HOST = "0.0.0.0"`.
Only do that on a network you trust — the app serves plain HTTP locally.

## API

| Method | Path                     | Description                    |
| ------ | ------------------------ | ------------------------------ |
| POST   | `/api/signup`            | Create an account              |
| POST   | `/api/login`             | Sign in, sets a session cookie |
| POST   | `/api/logout`            | Sign out                       |
| GET    | `/api/me`                | Current signed-in user         |
| GET    | `/api/admin/users`       | List users (admin only)        |
| DELETE | `/api/admin/users/:id`   | Delete a user (admin only)     |

## Notes

- Sessions live in the database, expire after 7 days, and are revoked on logout
  or when the user is deleted.
- Login and signup are rate limited per IP.
- Pages are served with a strict Content-Security-Policy, and cookies are
  `HttpOnly` + `SameSite=Lax`.
- This is a local demo app. For public deployment, put it behind HTTPS (and set
  a reverse proxy that terminates TLS) before sharing it with anyone.
=======
# login
>>>>>>> 37c38c7db6aa81bfce64bd3a44b9ec713fcdd6bb
