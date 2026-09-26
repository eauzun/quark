// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract SkillBadge {
    address public immutable oracle;
    mapping(address => mapping(bytes32 => bool)) public hasBadge;
    event BadgeMinted(address indexed worker, bytes32 indexed skillId);

    constructor(address oracle_) {
        require(oracle_ != address(0), "Zero oracle");
        oracle = oracle_;
    }

    function mintBadge(address worker, bytes32 skillId, bytes calldata signature) external {
        require(worker != address(0) && skillId != bytes32(0), "Invalid badge");
        require(!hasBadge[worker][skillId], "Already minted");
        // Bind attestations to both chain and deployment to prevent cross-domain replay.
        bytes32 payload = keccak256(abi.encode(block.chainid, address(this), worker, skillId));
        require(ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(payload), signature) == oracle, "Invalid oracle");
        hasBadge[worker][skillId] = true;
        emit BadgeMinted(worker, skillId);
    }
}
