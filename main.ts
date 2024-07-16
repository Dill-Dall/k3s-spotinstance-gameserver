import { App } from 'cdktf';
import * as dotenv from 'dotenv';
import { TemplateAutoScalingStack, AutoscalingStackConfig } from './stacks/TemplateAutoScalingStack';
import { ValheimAWSStackDependencies } from './stacks/ValheimAWSStackDependencies';
import { valheimUserdataTemplate } from './userdata/valheimUserDataTemplate';
import { k3sMasterUserDataTemplate } from './userdata/k3sMasterUserDataTemplate';
dotenv.config();
const topDomain = process.env.DOMAIN ?? (() => { throw new Error("No DOMAIN specified in .env"); })();


const masterK3sConfig: AutoscalingStackConfig = createMasterK3sConfig();
const valheimGameServerConfig: AutoscalingStackConfig = CreateValheimGameServerConfig();

const app = new App();
new TemplateAutoScalingStack(app, "K3sMaster", masterK3sConfig);
new TemplateAutoScalingStack(app, "ValheimGameServer", valheimGameServerConfig);
new ValheimAWSStackDependencies(app, "ValheimAWSResources");
app.synth();



function createMasterK3sConfig() {
  const masterK3sUserData = k3sMasterUserDataTemplate("k3s." + topDomain);
  const masterK3sConfig: AutoscalingStackConfig = {
    userDataString: masterK3sUserData,
    instanceType: "t4g.medium",
    ami: "ami-0da41a36dad7ce8f4",
    domain: ["k3s." + topDomain, "grafana." + topDomain]
  };
  return masterK3sConfig;
}


function CreateValheimGameServerConfig() {
  const accountNumber = process.env.AWS_ACCOUNT_NUMBER ?? (() => { throw new Error("No AWS_ACCOUNT_NUMBER defined in .env"); })();
  const password = process.env.VALHEIM_PASSWORD ?? (() => { throw new Error("No Valheim password specified in .env"); })();

  const s3Bucket = `s3://valheim-${accountNumber}/valheim-data/`;
  const instanceName = "ValheimGameServer";
  const valheimUserData = valheimUserdataTemplate(s3Bucket, instanceName, password, "valheim." + topDomain);

  const valheimGameServerConfig: AutoscalingStackConfig = {
    instanceType: "t3.large",
    ami: "ami-0f76a278bc3380848",
    ebsVolumeSize: 20,
    userDataString: valheimUserData,
    domain: ["valheim." + topDomain],
    openPorts: [{
      fromPort: 32456,
      toPort: 32458,
      protocol: "udp",
      description: "Allow valheim server traffic on ports 32456-32458"
    },
    {
      fromPort: 2456,
      toPort: 2458,
      protocol: "udp",
      description: "Allow valheim server traffic on ports 2456-2458"
    }],
    inlinePolcies: [
      {
        name: "AllowAssoication",
        policy: JSON.stringify({
          "Version": "2012-10-17",
          "Statement": [
            {
              "Effect": "Allow",
              "Action": [
                "ec2:DescribeAddresses",
                "ec2:DescribeInstances",
                "ec2:AssociateAddress"
              ],
              "Resource": "*"
            }
          ]
        }),
      },
      {
        name: "AllowValheimS3Access",
        policy: JSON.stringify({
          "Version": "2012-10-17",
          "Statement": [
            {
              "Effect": "Allow",
              "Action": [
                "s3:ListBucket",
                "s3:GetObject",
                "s3:PutObject",
                "s3:DeleteObject"
              ],
              "Resource": [
                `arn:aws:s3:::valheim-${accountNumber}`,
                `arn:aws:s3:::valheim-${accountNumber}/*`
              ]
            },
          ]
        }),
      }
    ]
  };
  return valheimGameServerConfig;
}

