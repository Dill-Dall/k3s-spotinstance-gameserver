
import { S3Bucket } from "@cdktf/provider-aws/lib/s3-bucket";
import { TerraformStack } from "cdktf";
import { Construct } from "constructs";
import { ProviderConstruct } from "./utils";

export class ValheimAWSStackDependencies extends TerraformStack {
	constructor(scope: Construct, id: string) {
		super(scope, id);

		new ProviderConstruct(this, "ValheimGameServer/" + id, {
			Name: "ValheimGameServer",
		})

		const accountNumber = process.env.AWS_ACCOUNT_NUMBER ?? (() => { throw new Error("No AWS_ACCOUNT_NUMBER defined in .env"); })();

		new S3Bucket(this, "valheim", {
			bucket: `valheim-${accountNumber}`
		})
	}
}
