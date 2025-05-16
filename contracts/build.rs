use sp1_helper::{build_program_with_args, BuildArgs};

fn main() {
    build_program_with_args(
        "./contract1",
        BuildArgs {
            features: vec!["sp1".to_string()],
            ..Default::default()
        },
    )
}
