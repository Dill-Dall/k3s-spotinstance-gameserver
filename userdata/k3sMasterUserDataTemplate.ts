export const k3sMasterUserDataTemplate = (domain: string) => `

#!/bin/bash

# Update package repository and install necessary packages
sudo apt-get update -y
sudo apt-get install -y awscli

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

# Install K3s with the --tls-san flag
curl -sfL https://get.k3s.io | sh -s - server --tls-san ${domain} --data-dir /mnt/ebs/k3s &


sudo chown -R ec2-user:ec2-user /etc/rancher/k3s/k3s.yaml

mkdir $HOME/.kube
sudo cp /etc/rancher/k3s/k3s.yaml $HOME/.kube/config
sudo chmod 644 $HOME/.kube/config

mkdir /home/ec2-user/.kube
sudo cp /etc/rancher/k3s/k3s.yaml $HOME/.kube/config
sudo chown -R ec2-user:ec2-user /home/ec2-user/.kube/config

export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
until kubectl get nodes &>/dev/null; do
  echo "Waiting for k3s to be ready..."
  sleep 5
done

# Install Helm
curl https://raw.githubusercontent.com/helm/helm/master/scripts/get-helm-3 | bash

# Add Helm repositories
helm repo add grafana https://grafana.github.io/helm-charts
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo add jetstack https://charts.jetstack.io
helm repo update

# Create Grafana values file
cat <<EOF > grafana-values.yaml
datasources:
  datasources.yaml:
    apiVersion: 1
    datasources:
    - name: Prometheus
      type: prometheus
      access: proxy
      url: http://prometheus-server.monitoring.svc.cluster.local
      isDefault: true
      version: 1
      editable: true

ingress:
  enabled: true
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: web
  spec:
    ingressClassName: traefik
    rules:
    - host: ${domain}
      http:
        paths:
        - backend:
            service:
              name: grafana
              port:
                number: 3000
          path: /
          pathType: Prefix
EOF


helm install \
 cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --version v1.14.7 \
  --create-namespace \
  --kubeconfig /etc/rancher/k3s/k3s.yaml \
  --set installCRDs=true &

helm install \
 my-grafana grafana/grafana \
 --namespace monitoring \
 --create-namespace \
 --values grafana-values.yaml \
 --kubeconfig /etc/rancher/k3s/k3s.yaml

sudo chown -R ec2-user:ec2-user /etc/rancher/k3s/k3s.yaml
echo "Script execution completed."
`


