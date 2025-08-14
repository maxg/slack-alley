FROM mcr.microsoft.com/devcontainers/typescript-node:1-22

ENV NODE_OPTIONS="--experimental-strip-types --disable-warning=ExperimentalWarning"

ARG TERRAFORM_VERSION=1.12.2

RUN cd /tmp && curl -sSL -o terraform.zip https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_arm64.zip && unzip terraform.zip && mv terraform /usr/local/bin/ && rm terraform.zip

ENV TF_VAR_node_version=$NODE_VERSION
ENV TF_VAR_node_options=$NODE_OPTIONS
