# try-runtime Helm Chart

Notes:

- Consider passing application environment variables to gitlab runners.
- This helm chart assigns `try-runtime.parity.io` domains to the application.
this would be accessible from the public network and will route all the
traffics to port 80 of the container.

See the [Gitlab CI configuration](../.gitlab-ci.yml) for an example of how to
deploy it through Helm.
