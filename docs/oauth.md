# OAuth

Create an Oura app at https://cloud.ouraring.com/oauth/applications.

Callback URL:

```text
http://127.0.0.1:3000/callback
```

Recommended scopes (full Oura consent set):

```text
personal daily email heartrate workout tag session spo2 ring_configuration stress heart_health
```

Run:

```bash
npx -y oura-mcp-unofficial setup
npx -y oura-mcp-unofficial auth
npx -y oura-mcp-unofficial doctor
```
