# es-linux-self-checker

For a linux VM (aws linux2 ami), script to check-health and report to es index instance_checks-YYYYMM

# Setup

After cloning, you will need to set real `"username"` and `"password"`.

Also probable you will need something like:

```bash
chmod +x ./instance-health.js
```

## Installing git

```bash
sudo yum update -y
sudo yum install git -y
git --version
```

### Cloning

```bash
git clone https://github.com/readonlychild/es-linux-self-checker.git ~/health
cd ~/health
npm install
node ./instance-health.js
```

### Install node

```bash
# Install NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.nvm/nvm.sh

# Install Node 16 (works perfectly with glibc 2.26)
nvm install 16

# Make it default
nvm alias default 16
nvm use 16

# Verify
node -v
npm -v
```