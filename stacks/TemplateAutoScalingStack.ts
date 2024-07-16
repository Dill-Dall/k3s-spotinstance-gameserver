import { Construct } from "constructs";
import { Fn, TerraformIterator, TerraformOutput, TerraformStack } from "cdktf";
import { IamRole, IamRoleInlinePolicy } from "@cdktf/provider-aws/lib/iam-role";
import { IamRolePolicyAttachment } from "@cdktf/provider-aws/lib/iam-role-policy-attachment";
import { IamInstanceProfile } from "@cdktf/provider-aws/lib/iam-instance-profile";
import { SecurityGroup } from "@cdktf/provider-aws/lib/security-group";
import { SecurityGroupRule } from "@cdktf/provider-aws/lib/security-group-rule";
import { readFileSync } from "fs";
import { DataAwsVpc } from "@cdktf/provider-aws/lib/data-aws-vpc";
import { LaunchTemplate } from "@cdktf/provider-aws/lib/launch-template";
import { AutoscalingGroup } from "@cdktf/provider-aws/lib/autoscaling-group";
import { AutoscalingPolicy } from "@cdktf/provider-aws/lib/autoscaling-policy";
import { AutoscalingSchedule } from "@cdktf/provider-aws/lib/autoscaling-schedule";
import { DataAwsSubnets } from "@cdktf/provider-aws/lib/data-aws-subnets";
import { DataAwsInstances } from "@cdktf/provider-aws/lib/data-aws-instances";

import { Route53Record } from "@cdktf/provider-aws/lib/route53-record";
import { DataAwsRoute53Zone } from "@cdktf/provider-aws/lib/data-aws-route53-zone";
import { Eip } from "@cdktf/provider-aws/lib/eip";
import { EipAssociation } from "@cdktf/provider-aws/lib/eip-association";
import { ProviderConstruct } from "./utils";

export interface AutoscalingStackConfig {
	userdataPath?: string;
	instanceType: string;
	ebsVolumeSize?: number;
	ebsVolumeType?: string;
	domain?: string[];
	inlinePolcies?: IamRoleInlinePolicy[];
	ami: string;
	userDataString?: string;
	openPorts?: { fromPort: number; toPort: number; protocol: string; description?: string }[];
}


export class TemplateAutoScalingStack extends TerraformStack {
	vpc: DataAwsVpc
	securityGroup: SecurityGroup
	id: string
	config: AutoscalingStackConfig
	constructor(scope: Construct, id: string, config: AutoscalingStackConfig) {
		super(scope, id);
		this.id = id
		this.config = config
		new ProviderConstruct(this, this.id + "/TemplateAutoScalingStack", {
			Name: this.id,
		})

		this.vpc = new DataAwsVpc(this, "selected", {
			tags: {
				Name: "vpc"
			}
		});

		this.securityGroup = this.createSecGroup();

		const instanceProfile = this.createIamRole();
		const launchTemplate = this.createLaunchTemplate(instanceProfile);
		const asg = this.createAutoScalingGroup(launchTemplate);
		this.createScalingPolicies(asg);
		this.createScheduledActions(asg);

		const instances = new DataAwsInstances(this, 'asg_instances', {
			filter: [
				{
					name: 'tag:Name',
					values: [this.id],
				},
			],
		});


		if (this.config.domain) {
			this.createRecords(instances, this.config.domain);
		}

		new TerraformOutput(this, "asg_instance_ips", {
			value: instances.publicIps,
			sensitive: false,
			description: "IDs of instances in the autoscaling group",
		});
	}


	private createRecords(instances: DataAwsInstances, domains: string[]) {

		const hostedZone = new DataAwsRoute53Zone(this, "datahostedZone", {
			name: "dahll.dev."
		});
		const instanceIdsIterator = TerraformIterator.fromList(instances.ids);

		const eip = new Eip(this, "eip", { domain: "vpc" });

		new EipAssociation(this, "eip_assoc", {
			forEach: instanceIdsIterator,
			allocationId: eip.allocationId,
			instanceId: Fn.element(instances.ids, 0),
		});

		domains.forEach((value, i) => {
			const record = new Route53Record(this, 'ASGPublicIPs_' + i, {
				zoneId: hostedZone.id,
				name: `${value}`,
				type: 'A',
				ttl: 60,
				records: [eip.publicIp],
			});

			new TerraformOutput(this, 'A_Record_' + i, {
				value: record
			});
		})




	}

	private createSecGroup() {

		const privateIps = JSON.parse(process.env.PRIVATE_IPS || '[]');
		const sg = new SecurityGroup(this, "sec_group", {
			name: this.id,
			description: "Allow SSH from a specific IP",
			vpcId: this.vpc.id,
			tags: {
				Name: `${this.id}`
			}
		});


		new SecurityGroupRule(this, "eggress", {
			description: "home",
			type: "egress",
			fromPort: 0,
			toPort: 0,
			protocol: "-1",
			cidrBlocks: ["0.0.0.0/0"],
			securityGroupId: sg.id,
		});

		new SecurityGroupRule(this, "ssh_sg_rule", {
			description: "home",
			type: "ingress",
			fromPort: 0,
			toPort: 15000,
			protocol: "tcp",
			cidrBlocks: privateIps,
			securityGroupId: sg.id,
		});

		new SecurityGroupRule(this, "self_rule", {
			description: "self",
			type: "ingress",
			fromPort: 0,
			toPort: 0,
			protocol: "-1",
			selfAttribute: true,
			securityGroupId: sg.id,
		});


		if (this.config.openPorts) {
			this.config.openPorts.forEach(portConfig =>
				new SecurityGroupRule(this, `rule_${portConfig.fromPort}_${portConfig.toPort}_${portConfig.protocol}`, {
					description: portConfig.description || `Allow ${portConfig.protocol.toUpperCase()} traffic on ports ${portConfig.fromPort}-${portConfig.toPort}`,
					type: "ingress",
					fromPort: portConfig.fromPort,
					toPort: portConfig.toPort,
					protocol: portConfig.protocol,
					cidrBlocks: ["0.0.0.0/0"],
					securityGroupId: sg.id,
				}));
		};


		return sg
	}

	private createIamRole() {
		const ssmRole = new IamRole(this, "ssmRole", {
			name: this.id + "ec2-ssm-role",
			assumeRolePolicy: JSON.stringify({
				Version: "2012-10-17",
				Statement: [
					{
						Effect: "Allow",
						Principal: {
							Service: "ec2.amazonaws.com",
						},
						Action: "sts:AssumeRole",
					},
				],
			}),
			inlinePolicy: this.config.inlinePolcies
		});

		// Attach SSM Managed Policy to the Role
		new IamRolePolicyAttachment(this, "ssmRolePolicyAttachment", {
			policyArn: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
			role: ssmRole.name,
		});

		// Create Instance Profile
		const instanceProfile = new IamInstanceProfile(this, "instanceProfile", {
			name: this.id + "-ec2-ssm-instance-profile",
			role: ssmRole.name,
		});
		return instanceProfile;
	}

	private createLaunchTemplate(instanceProfile: IamInstanceProfile): LaunchTemplate {
		let userData: String;
		if (this.config.userdataPath) {
			userData = readFileSync(this.config.userdataPath, 'utf8');
		} else if (this.config.userDataString) {
			userData = this.config.userDataString;
		} else {
			throw new Error('No user data')
		}

		return new LaunchTemplate(this, "launch_template", {
			name: this.id + "-launch-template",
			imageId: this.config.ami,
			instanceType: "t4g.micro",

			keyName: "aws_servers",
			blockDeviceMappings: [
				{
					deviceName: "/dev/sdh", // You can change this to a different device name if needed
					ebs: {
						volumeSize: this.config.ebsVolumeSize ?? 10,
						volumeType: this.config.ebsVolumeType ?? "gp3",
						deleteOnTermination: "true",
					},
				},
			],
			networkInterfaces: [
				{
					securityGroups: [this.securityGroup.id],
					associatePublicIpAddress: "true",
				},
			],
			iamInstanceProfile: {
				name: instanceProfile.name,
			},
			userData: Buffer.from(userData).toString("base64"),
			tagSpecifications: [{
				resourceType: "instance",
				tags: {
					Name: this.id,
				},
			}],
		});
	}

	private createAutoScalingGroup(launchTemplate: LaunchTemplate): AutoscalingGroup {
		const publicSubnets = new DataAwsSubnets(this, 'public_subnets', {
			filter: [
				{
					name: 'vpc-id',
					values: [this.vpc.id],
				},
				{
					name: 'tag:Name',
					values: ['*public*'],
				},
			],
		});

		const asg = new AutoscalingGroup(this, 'autoscalingGroup', {
			name: this.id + '-master-scaling-group',
			desiredCapacity: 1,
			maxSize: 2,
			minSize: 0,
			instanceRefresh: {
				preferences: {
					minHealthyPercentage: 50,
				},
				strategy: "Rolling",
				triggers: ["tag"],
			},
			vpcZoneIdentifier: publicSubnets.ids,
			tag: [{
				key: 'Name',
				value: this.id,
				propagateAtLaunch: true,
			},
			{
				key: 'latestTemplate',
				value: `${launchTemplate.latestVersion}`,
				propagateAtLaunch: true,
			}
			],
			mixedInstancesPolicy: {
				launchTemplate: {
					launchTemplateSpecification: {
						launchTemplateId: launchTemplate.id,
						version: '$Latest',
					},
					override: [{
						instanceType: this.config.instanceType,
						weightedCapacity: '1',
					}],
				},
				instancesDistribution: {
					onDemandPercentageAboveBaseCapacity: 0,
					spotAllocationStrategy: 'lowest-price',
				},
			},
		});

		return asg;
	}

	private createScalingPolicies(asg: AutoscalingGroup): void {
		new AutoscalingPolicy(this, "scale_up_policy", {
			name: "scale_up_policy",
			autoscalingGroupName: asg.name,
			scalingAdjustment: 1,
			adjustmentType: "ChangeInCapacity",
		});

		new AutoscalingPolicy(this, "scale_down_policy", {
			name: "scale_down_policy",
			autoscalingGroupName: asg.name,
			scalingAdjustment: -1,
			adjustmentType: "ChangeInCapacity",
		});
	}
	private createScheduledActions(asg: AutoscalingGroup): void {
		new AutoscalingSchedule(this, "scale_down_at_night", {
			autoscalingGroupName: asg.name,
			desiredCapacity: 0,
			minSize: 0,
			maxSize: 0,
			scheduledActionName: "scale-down-at-night",
			recurrence: "0 0 * * *", // Every day at midnight UTC
		});

		new AutoscalingSchedule(this, "scale_up_in_morning", {
			autoscalingGroupName: asg.name,
			desiredCapacity: 1,
			minSize: 1,
			maxSize: 3,
			scheduledActionName: "scale-up-in-morning",
			recurrence: "0 6 * * *", // Every day at 6 AM UTC
		});
	}


}
