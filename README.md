# devkit

Run all OpenHotel stack locally with Docker.

| Service      | Repo                     | URL                   |
| ------------ | ------------------------ | --------------------- |
| client       | `openhotel/openhotel`    | http://localhost:1994 |
| auth         | `openhotel/auth`         | http://localhost:2024 |
| web          | `openhotel/web`          | http://localhost:2025 |
| onet         | `openhotel/onet`         | http://localhost:9400 |
| asset-editor | `openhotel/asset-editor` | http://localhost:2030 |
| static       | `openhotel/static`       | http://localhost:1995 |
| s3           | SeaweedFS                | http://localhost:9000 |

## Requirements

- Docker
- Deno
- Git

The service repos are cloned next to this one (or in `REPOS_DIR` from `.env`):

```
openhotel/
├── devkit/
├── openhotel/
├── auth/
├── onet/
├── web/
├── asset-editor/
└── static/
```

## Usage

```bash
deno task setup                # clone missing repos and create dev configs
deno task up                   # everything (in background)
deno task up auth client       # some services
deno task logs                 # logs of all services
deno task logs client          # logs of one service
deno task down                 # stop everything
```

## S3

```yaml
s3:
  enabled: true
  endpoint: localhost
  port: 9000
  useSSL: false
  accessKey: openhotel
  secretKey: openhotel
  region: us-east-1
  bucket: <service-name>
```
