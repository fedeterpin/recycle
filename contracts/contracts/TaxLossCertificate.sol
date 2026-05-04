// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";

/// @title TaxLossCertificate — On-chain proof of token disposal for tax purposes
/// @notice Minted by the Incinerator on every successful burn. The NFT records
///         the token address, amount, USD value at burn time, and timestamp.
///         This serves as irrefutable on-chain evidence that the user disposed
///         of the asset with an exit value of zero.
contract TaxLossCertificate is ERC721, AccessControl {
    using Strings for uint256;
    using Strings for address;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    uint256 public nextTokenId = 1;

    struct BurnRecord {
        address token;       // Token that was burned
        uint256 amount;      // Amount burned (in token's native units)
        uint256 usdValue;    // USD value at burn time (18 decimals, 0 if token had no price)
        uint256 timestamp;   // Block timestamp of the burn
    }

    mapping(uint256 => BurnRecord) public records;

    event CertificateMinted(
        uint256 indexed tokenId,
        address indexed holder,
        address indexed token,
        uint256 amount,
        uint256 usdValue
    );

    constructor(address admin) ERC721("RCY Tax Loss Certificate", "RCYTLC") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Mint a certificate. Only callable by the Incinerator.
    function mint(
        address to,
        address token,
        uint256 amount,
        uint256 usdValue
    ) external onlyRole(MINTER_ROLE) returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        records[tokenId] = BurnRecord({
            token: token,
            amount: amount,
            usdValue: usdValue,
            timestamp: block.timestamp
        });
        _mint(to, tokenId);
        emit CertificateMinted(tokenId, to, token, amount, usdValue);
    }

    /// @notice Fully on-chain metadata. No IPFS dependency — the certificate
    ///         remains renderable forever, regardless of pinning services.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        BurnRecord memory r = records[tokenId];

        bytes memory json = abi.encodePacked(
            '{"name":"Recycle Loss Certificate #', tokenId.toString(),
            '","description":"On-chain proof that the holder disposed of an ERC-20 asset via the Recycle Protocol Incinerator.",',
            '"attributes":[',
                '{"trait_type":"Token","value":"', r.token.toHexString(), '"},',
                '{"trait_type":"Amount","value":"', r.amount.toString(), '"},',
                '{"trait_type":"USD Value (1e18)","value":"', r.usdValue.toString(), '"},',
                '{"display_type":"date","trait_type":"Burned At","value":', r.timestamp.toString(),
            '}]}'
        );

        return string(
            abi.encodePacked("data:application/json;base64,", Base64.encode(json))
        );
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
