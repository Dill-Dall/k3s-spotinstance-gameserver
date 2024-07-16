import { AwsProvider } from "@cdktf/provider-aws/lib/provider";
import { S3Backend } from "cdktf";
import { Construct } from "constructs";


export class ProviderConstruct extends Construct {
	constructor(scope: Construct, key: string, tags: { [key: string]: string }) {
		super(scope, "provider");

		const s3BackendBucket = process.env.S3_BACKEND ?? (() => { throw new Error("No S3_BACKEND_BUCKET specified in .env"); })();

		new AwsProvider(this, "AWS", {
			region: "eu-north-1",
			defaultTags: [
				{
					tags: {
						Terraform: "true",
						...tags
					},
				},
			]
		});

		new S3Backend(this, {
			bucket: s3BackendBucket,
			key: key,
			region: "eu-north-1",
		});
	}
}