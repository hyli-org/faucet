mod metadata {
    pub const CONTRACT_ELF: &[u8] = include_bytes!("../elf/contract1");
}

pub use metadata::*;
