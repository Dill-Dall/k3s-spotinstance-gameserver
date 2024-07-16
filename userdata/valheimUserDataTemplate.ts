const installPackages = () => `
# Update package repository and install necessary packages
sudo apt-get update -y
sudo apt-get install -y awscli
`;

const setupNVMeDevice = () => `
# Check if the NVMe device exists and format/mount it
if [ -e /dev/nvme1n1 ]; then
  DEVICE="/dev/nvme1n1"
  sudo mkfs -t ext4 $DEVICE
  sudo mkdir -p /mnt/ebs
  sudo mount $DEVICE /mnt/ebs
  echo "$DEVICE /mnt/ebs ext4 defaults,nofail 0 2" | sudo tee -a /etc/fstab
else
  echo "Device /dev/nvme1n1 not found"
fi
# Change permissions so ec2-user can use the directory
sudo chown -R ec2-user:ec2-user /mnt/ebs
`;

const installK3s = (domain: string) => `
curl -sfL https://get.k3s.io | sh -s - server --data-dir  --tls-san ${domain} /mnt/ebs/k3s

export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
until kubectl get nodes &>/dev/null; do
  echo "Waiting for k3s to be ready..."
  sleep 5
done

mkdir $HOME/.kube
sudo cp /etc/rancher/k3s/k3s.yaml $HOME/.kube/config
sudo chmod 644 $HOME/.kube/config

mkdir /home/ec2-user/.kube
sudo cp /etc/rancher/k3s/k3s.yaml /home/ec2-user/.kube/config
sudo chown -R ec2-user:ec2-user /home/ec2-user/.kube/config

sudo chown -R ec2-user:ec2-user /mnt/ebs
`;

const setupHelmAndValheim = (s3Bucket: string, password: string) => `
# Execute helm install as EC2 user. So as to be able to jump in afterwards
sudo -i -u ec2-user bash << 'USER_CMDS'
curl https://raw.githubusercontent.com/helm/helm/master/scripts/get-helm-3 | bash
echo 'export PATH=$PATH:/usr/local/bin' >> /home/ec2-user/.bashrc
source /home/ec2-user/.bashrc

# Valheim setup
mkdir /mnt/ebs/valheim-server-config

aws s3 sync ${s3Bucket} /mnt/ebs/valheim-server-config/

cat <<EOF > $HOME/values.yaml
resources:
  requests:
    memory: 6Gi
    cpu: "1500m" 
valheimServer:
  serverPass: ${password}
persistence:
  config:
    s3Path: ${s3Bucket}
EOF

helm repo add dilldall https://Dill-Dall.github.io/helm/
helm repo update

helm install valheim-server dilldall/valheim -n valheim -f $HOME/values.yaml --create-namespace
USER_CMDS
`;

const associateEIP = (instanceName: string) => `
# POST COMMANDS
echo "EXECUTING POST COMMANDS"

# Find the Allocation ID of the EIP with the tag Name:valheim
EIP_ALLOCATION_ID=$(aws ec2 describe-addresses --filters "Name=tag:Name,Values=${instanceName}" --query 'Addresses[0].AllocationId' --output text --region eu-north-1)

# Find the instance ID of the current instance
INSTANCE_ID=$(curl http://169.254.169.254/latest/meta-data/instance-id)

# Associate the EIP with the current instance
if [ "$EIP_ALLOCATION_ID" != "None" ]; then
  aws ec2 associate-address --instance-id $INSTANCE_ID --allocation-id $EIP_ALLOCATION_ID --region eu-north-1
else
  echo "No EIP found with tag Name:${instanceName}"
fi
`;

const setupInotify = (s3Bucket: string) => `
sudo amazon-linux-extras install epel -y
sudo yum install inotify-tools -y

# Create the watch and sync script
sudo cat <<'EOF' > $HOME/watch_and_sync.sh
#!/bin/bash

# Directory to watch
WATCH_DIR="/mnt/ebs/valheim-server-config"

# Function to sync to S3
sync_to_s3() {
    aws s3 sync $WATCH_DIR/ ${s3Bucket}
}

# Initial sync
sync_to_s3

# Monitor the directory for changes and sync to S3
inotifywait -m -r -e modify,create,delete,move $WATCH_DIR |
while read path action file; do
    echo "The file '$file' in directory '$path' was $action"
    sync_to_s3
done
EOF

# Make the script executable
sudo chmod +x $HOME/watch_and_sync.sh

nohup $HOME/watch_and_sync.sh &
`;

export const valheimUserdataTemplate = (s3Bucket: string, instanceName: string, password: string, domain: string) => `
#!/bin/bash
${installPackages()}
${setupNVMeDevice()}
${installK3s(domain)}
${setupHelmAndValheim(s3Bucket, password)}
${associateEIP(instanceName)}
${setupInotify(s3Bucket)}
`;

