mod metadata {
    use sp1_sdk::include_elf;

    pub const CONTRACT_ELF: &[u8] = include_elf!("contract1");
}

pub use metadata::*;
