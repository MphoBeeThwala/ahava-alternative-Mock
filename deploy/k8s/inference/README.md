# Inference on Kubernetes (cost-sensitive)

This deploys the ML inference service on your Kubernetes node and exposes it via a Cloudflare Tunnel, keeping the public URL:

`https://inference.ahavaon88.co.za`

## Step 1: Build and publish the ML service image

You need a container registry. The simplest is Docker Hub.

From your laptop (repo root):

```powershell
docker build -t YOUR_DOCKERHUB_USER/ahava-ml:latest -f apps/ml-service/Dockerfile .
docker push YOUR_DOCKERHUB_USER/ahava-ml:latest
```

## Step 2: Deploy the ML service to Kubernetes

Edit [ml-service.yaml](file:///c:/Users/User/ahava-healthcare-1/deploy/k8s/inference/ml-service.yaml) and replace:

- `REPLACE_ME_IMAGE` with `YOUR_DOCKERHUB_USER/ahava-ml:latest`

Apply:

```bash
kubectl apply -f deploy/k8s/inference/ml-service.yaml
```

Verify:

```bash
kubectl -n ahava-ml get pods
kubectl -n ahava-ml port-forward svc/ahava-ml-service 8000:8000
```

Then open:

- http://127.0.0.1:8000/docs

## Step 3: Create a new Cloudflare Tunnel token

Cloudflare Dashboard → Zero Trust → Tunnels → Create Tunnel → Cloudflared.

Copy the tunnel token.

## Step 4: Run the tunnel inside Kubernetes

Edit [cloudflared.yaml](file:///c:/Users/User/ahava-healthcare-1/deploy/k8s/inference/cloudflared.yaml) and replace:

- `REPLACE_ME_TUNNEL_TOKEN` with the token you copied

Apply:

```bash
kubectl apply -f deploy/k8s/inference/cloudflared.yaml
```

## Step 5: Map the hostname to the Kubernetes service

Cloudflare Dashboard → Zero Trust → Tunnels → your new tunnel → Public Hostnames → Add.

Set:

- Subdomain: `inference`
- Domain: `ahavaon88.co.za`
- Service: `http://ahava-ml-service.ahava-ml.svc.cluster.local:8000`

Verify from anywhere:

- https://inference.ahavaon88.co.za/docs

## Step 6: Confirm Railway backend points to inference

Railway backend variables:

- `ML_SERVICE_URL=https://inference.ahavaon88.co.za`

