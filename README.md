Using CDKTF for deploying ec2 scaleable spot instances running k3s to host gameservers. (Valheim)

The point of the project is to see how cheap I can host gameservers online in a persistent manner.
The persistence is retained by sending mnt data to s3, when changed, which is fetched on new deploys.

## No loadbalancer (couse cheap)
The existing Elastic IP always gets attatched to the newest booted spot instance.  
I bought myself a Domain at dahll.dev (gcp) which I hostedzone-record to the EIP


## Uses the helm lib
https://Dill-Dall.github.io/helm/valheim
hosted at https://github.com/Dill-Dall/helm/tree/main

## Userdata
The bash file contains a couple of processes needed in order to run the server. With templated values from typescript.
```bash
${installPackages()}
${setupNVMeDevice()}
${installK3s(domain)}
${setupHelmAndValheim(s3Bucket, password)}
${associateEIP(instanceName)}
${setupInotify(s3Bucket)}
```