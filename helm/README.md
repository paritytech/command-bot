# Try-Runtime Helm chart
#### Install
- consider passing application environment variables to gitlab runners.
- this helm chart assigns `try-runtime.parity.io` domains to the application. this would be accessible from the public network and will route all the traffics to port 80 of the container.

```
helm upgrade --install try-runtime ./helm \
  --values helm/values.yaml \
  --namespace try-runtime \
  --set image.repository="paritytech/try-runtime-bot" \
  --set image.tag="parity-prod" \
  --set env.APP_ID="$APP_ID" \
  --set env.CLIENT_ID="$CLIENT_ID" \
  --set env.CLIENT_SECRET="$CLIENT_SECRET" \
  --set env.WEBHOOK_SECRET="$WEBHOOK_SECRET" \
  --set env.PRIVATE_KEY_BASE64="$PRIVATE_KEY_BASE64" \
  --set env.ALLOWED_ORGANIZATIONS="$ALLOWED_ORGANIZATIONS" \
  --set env.DB_PATH="/data/" \
  --set env.ROCOCO_WEBSOCKET_ADDRESS="$ROCOCO_WEBSOCKET_ADDRESS" \
  --set env.POLKADOT_WEBSOCKET_ADDRESS="$POLKADOT_WEBSOCKET_ADDRESS" \
  --set env.KUSAMA_WEBSOCKET_ADDRESS="$KUSAMA_WEBSOCKET_ADDRESS" \
  --set env.WESTEND_WEBSOCKET_ADDRESS="$WESTEND_WEBSOCKET_ADDRESS" \
  --set persistence.mountPath="/data/"
```
