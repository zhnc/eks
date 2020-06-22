from aws_cdk import (
    aws_ec2 as ec2,
    aws_iam as iam,
    aws_eks as eks,
    core
)


class VpcStack(core.Stack):

    def __init__(self, scope: core.Construct, id: str, props, **kwargs) -> None:
        super().__init__(scope, id, **kwargs)

     # The code that defines your stack goes here
        self.vpc = ec2.Vpc(self, "VPC",
                           max_azs=3,
                           cidr="10.10.0.0/16",
                           # configuration will create 3 groups in 2 AZs = 6 subnets.
                           subnet_configuration=[ec2.SubnetConfiguration(
                               subnet_type=ec2.SubnetType.PUBLIC,
                               name="PublicSubnet",
                               cidr_mask=24
                           ), ec2.SubnetConfiguration(
                               subnet_type=ec2.SubnetType.PRIVATE,
                               name="PrivateSubnet",
                               cidr_mask=24
                           )],
                           # nat_gateway_provider=ec2.NatProvider.gateway(),
                           nat_gateways=2,
                           gateway_endpoints={
                               "S3": ec2.GatewayVpcEndpointOptions(
                                   service=ec2.GatewayVpcEndpointAwsService.S3
                               )
                           })
        self.vpc.add_flow_log("FlowLogS3", destination=ec2.FlowLogDestination.to_s3(
        ), traffic_type=ec2.FlowLogTrafficType.REJECT)

        props["vpc"] = self.vpc
