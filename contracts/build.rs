#[cfg(not(feature = "build"))]
fn main() {}

#[cfg(feature = "build")]
use sp1_helper::{build_program_with_args, BuildArgs};
#[cfg(feature = "build")]
fn main() {
    build_program_with_args(
        "./contract1",
        BuildArgs {
            features: vec!["sp1".to_string()],
            output_directory: Some("../elf".to_string()),

            ..Default::default()
        },
    )
}
