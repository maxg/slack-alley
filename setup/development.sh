#!/bin/bash

cd /vagrant

# Apt Repositories
cat > /etc/apt/sources.list.d/nodesource.list <<< 'deb https://deb.nodesource.com/node_12.x bionic main'
wget -qO - https://deb.nodesource.com/gpgkey/nodesource.gpg.key | apt-key add -
apt-get update

# Apt packages
apt-get install -y python-pip nodejs build-essential zip

# AWS CLI
pip install awscli --upgrade

# Time zone
timedatectl set-timezone America/New_York
